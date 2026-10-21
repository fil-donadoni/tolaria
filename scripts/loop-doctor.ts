#!/usr/bin/env bun
/**
 * `bun run loop:doctor` — find the claims nothing is going to release, and
 * (with `--release`) release them.
 *
 * WHY. An issue is claimed by putting `in-progress` on it, and the claim is
 * meant to come off on every exit path: the pass's own Release step, or
 * `claim-sweep.sh` at SessionEnd. Both can miss:
 *
 *   - a pass that dies mid-flight never reaches Release. Observed 2026-08-17:
 *     four headless passes ended their turn saying "waiting for the background
 *     job to finish" — in `claude -p` the end of the turn is the end of the
 *     process — after claiming #2445, #1969, #1851 and #1852.
 *   - the sweep releases exactly what the LEDGER says this session took, and
 *     until the fix alongside this file the ledger recorded only the FIRST
 *     issue of a batch claim. The other three were invisible to it.
 *
 * An orphaned claim is silent and permanent: every later pass sees
 * `in-progress` and skips the issue as somebody else's live work, forever. Six
 * were sitting in the queue when this was written.
 *
 * SAFE BY DEFAULT: reports and releases nothing. Even under `--release` it
 * only touches issues with NO branch and NO open PR anywhere — because the
 * sessions share one GitHub account, so "assigned to me" proves nothing about
 * which session owns a claim, and a wrong release unclaims live work.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, statSync } from "node:fs";
import { ORIGIN_BASE } from "./lib/branches";
import { CLAIM_LABEL, releaseEditArgs } from "./lib/claim-labels";
import { FAILED_LABEL, READY_LABEL } from "./lib/land-labels";
import {
    PASS_WORKFLOW,
    WORKFLOW_RUN_FIELDS,
    parseWorkflowRuns,
    passRunEvidence,
    type WorkflowRun,
} from "./lib/afk-dispatch";
import { orphanWorktrees } from "./lib/orphan-worktree";
import { primaryCheckout } from "./lib/primary-checkout";

export type ClaimFacts = {
    issue: number;
    title: string;
    /**
     * A branch on the REMOTE whose name ends in `issue-N`. Liveness: the work
     * left this machine, so something downstream (a review, the merge-train)
     * may still be holding it.
     */
    hasRemoteBranch: boolean;
    /**
     * A branch in the LOCAL repo only — no counterpart on the remote.
     *
     * This is NOT liveness on its own, and treating it as such was the bug
     * (measured 2026-08-20). A local branch outlives the process that made it:
     * when a pass is killed mid-edit its worktree and branch simply stay on
     * disk forever, so `hasBranch` stayed true and the claim read as live for
     * as long as anyone cared to look. Eight claims — four of them P0 — sat
     * that way for 25-36 hours while a driver ran continuously past them.
     */
    hasLocalBranch: boolean;
    /** An open PR whose head branch ends in `issue-N`. */
    hasOpenPr: boolean;
    /**
     * Where that PR stands in the land-runner's queue (issue #5469):
     * `ready` = labelled `ready-to-land` (the session handed off, the runner
     * lands it), `failed` = labelled `land-failed` (a repair pick), `null` =
     * neither, or no open PR. Optional so every caller that predates the
     * runner keeps its verdicts.
     */
    landQueue?: LandQueueState | null;
    /**
     * Hours since the claim was taken — its newest `in-progress` label event
     * (issue #6223) — or, when that time is unknown, since the issue was last
     * updated. Labelling updates the issue, so the fallback is never OLDER
     * than the claim: an unknown claim time can only make a claim look
     * younger, the direction that releases nothing.
     */
    ageHours: number;
    /**
     * The `afk-pass` runs named for this issue (`afk-pass #N`) and created
     * after the claim was taken (issue #6223) — the pipeline's evidence:
     *
     *   - `active`  — one is queued or running: the pipeline holds the claim.
     *   - `ended`   — every such run completed: the pipeline's pass is dead.
     *   - `none`    — no such run: a session outside the pipeline, or nothing.
     *   - `unknown` — the runs or the claim time could not be read. Proves
     *                 nothing, and never releases a claim on its own.
     *
     * Absent = `none`: a caller that reads no runs has no pipeline evidence.
     */
    run?: PassRunState;
    /**
     * Does the local-only branch hold work NEWER than the claim — a commit
     * past the base, or an uncommitted edit (issue #6223)? `false` = a stale
     * branch that predates the claim (a dead pass's leftover matching the
     * issue name, 1124 commits behind): not evidence of work. `null` / absent
     * = unknown, read as work — the reading that releases nothing.
     */
    localWorkSinceClaim?: boolean | null;
    /**
     * Is the OS process that took this claim still running? (#2627)
     *
     * TRI-STATE on purpose, and the third state is the important one:
     *
     *   - `true`  — a live process owns this claim. Never release it.
     *   - `false` — the owner is provably gone (its pid is dead, or the pid
     *               was recycled by a process that started at a different
     *               time). No age rule applies any more (issue #5174): the
     *               claim is `stranded`, `recoverable` or `orphan` at once,
     *               and the next pass resumes it. Only an `orphan` (nothing
     *               on any branch) is ever releasable.
     *   - `null`  — unknown. No owner was recorded for this claim (every row
     *               written before #2627 landed), or the process probe itself
     *               was unavailable. Also does not release anything on its
     *               own — the classifier behaves exactly as it did before.
     *
     * Only a POSITIVE reading moves a verdict: `null` never authorises a
     * release. The failure mode of this whole subsystem is unclaiming a
     * healthy concurrent pass, so a liveness fact we are unsure about must not
     * be the thing that does it.
     *
     * See `parseClaimOwners` / `isOwnerAlive` for how the join is made —
     * there is no pid anywhere in the GitHub API's idea of a claim, so it
     * comes from the claim journal, recorded at claim time.
     */
    ownerAlive: boolean | null;
    /**
     * Commits on the claim's local-only branch that exist nowhere else —
     * `git rev-list --count <base>..<branch>` (issue #3698).
     *
     *   - a positive number — the dead pass got as far as COMMITTING. That
     *     work exists only in its worktree, and the 24-hour local-branch rope
     *     below is 24 hours of nobody knowing it is there.
     *   - `0` — a branch with nothing on it. `wt:new` creates one before the
     *     pass writes a line, so this is the ordinary shape of a claim that
     *     died early, and there is nothing to recover.
     *   - `null` — unknown (the count could not be read). Like `ownerAlive`,
     *     unknown changes no verdict: it falls through to the age rules that
     *     were there before.
     */
    unpushedCommits: number | null;
    /**
     * Minutes since anything in the claim's worktree last changed — its
     * index, or any file `git status` names (issue #5174). Read only for a
     * dead owner with a local branch: the owner stamp is the claiming
     * `claude` pid, and an interactive session restarted with `--resume`
     * gets a NEW pid while its human keeps editing. `null` = no worktree or
     * unreadable — nobody can be at work in a worktree that does not exist.
     */
    worktreeQuietMinutes?: number | null;
};

/** Branch names split by where they live — see `fetchBranchNames`. */
export type BranchNames = {
    local: string[];
    remote: string[];
};

/** Every state a claim verdict can take. A runtime array, not a bare type
 *  union, so a drift guard can ITERATE it — the dashboard glossary's
 *  completeness test (#2629) reds when a state added here has no human label.
 *  A type union alone is invisible at runtime and cannot be checked. */
export const CLAIM_VERDICT_STATES = [
    "live",
    "orphan",
    "recoverable",
    "stranded",
    "suspect",
    "pr-open",
] as const;

/** What the `afk-pass` runs say about one claim — see `ClaimFacts.run`. */
export type PassRunState = "active" | "ended" | "none" | "unknown";

/** A PR's place in the land-runner's queue, by label (issue #5469). */
export type LandQueueState = "ready" | "failed";

export type ClaimVerdictState = (typeof CLAIM_VERDICT_STATES)[number];

export type ClaimVerdict = { state: ClaimVerdictState; reason: string };

/**
 * The classifier's own "too young to judge" cutoff — exported (#2632) so
 * every surface that needs the SAME number imports it instead of
 * re-declaring `2`. The dashboard's claims table amber-ages a claim past this
 * threshold (`dashboard/lib/nowClaims.ts`'s `MIN_AGE_HOURS`, kept
 * as a mirrored literal with its own drift-guard test, since a plain browser
 * `.js` module cannot import a `.ts` source at runtime — see
 * `TIMELINE_WINDOW_HOURS`/`WINDOW_HOURS` in `lib/loop-status.ts` /
 * `now-timeline.js` for the same pattern).
 */
export const DEFAULT_MIN_AGE_HOURS = 2;

/** A dead owner's claim younger than this is still `suspect` (issue #5174):
 *  `queue:claim` adds the label BEFORE it writes the journal row that moves
 *  the owner, so for that instant the journal can name a previous, dead
 *  claimant. Minutes, not the 2 h rope — it covers a write, not a pass. */
export const DEAD_OWNER_FLOOR_MINUTES = 5;

/** A claim with no proof either way — no run of its own, no owner on record
 *  in this machine's journal, no pushed work — is held this long before it
 *  reads `orphan` (issue #6223). Absence is not death: the session may run on
 *  another machine, whose journal and local branches nobody here can read,
 *  and a session pushes only at hand-off. Past a day it is not a slow pass —
 *  nothing in this loop stays unpushed that long. */
export const UNPROVEN_CLAIM_HOURS = 24;

/** A dead owner's worktree touched more recently than this is `live`
 *  (issue #5174) — see `ClaimFacts.worktreeQuietMinutes`. */
export const DEAD_OWNER_QUIET_MINUTES = 30;

/**
 * THE verdict on a claim (issue #6223): `loop:doctor`, the queue verbs, the
 * AFK dispatcher (its picker and its hold-time release) and `loop:status` all
 * call this, over the union of their evidence — no caller keeps a private
 * age, branch or run rule. Before, the dispatcher judged claims by `afk-pass`
 * runs alone and this file by the journal owner and age alone, and the two
 * disagreed claim by claim: 28 claims "orphan" here sat "live" there forever.
 *
 * The evidence rules, in order:
 *   - a run named for the issue proves the pipeline owns the claim: an
 *     active one holds it, and their end proves death;
 *   - a live owning process on this machine proves a session;
 *   - with neither, the claim is judged by its pushed work — and a local
 *     branch counts as work only if it holds something newer than the claim.
 * Unknown evidence never releases: only a POSITIVE death reading (a dead
 * journal owner, an ended run) or a day of nothing at all makes an `orphan`.
 *
 * Pure, because the alternative to a testable classifier here is a script that
 * unclaims another session's work and is discovered by the person whose work
 * vanished.
 *
 * `suspect` exists so the tool has somewhere to put "no branch, no PR, but
 * claimed minutes ago" — which is exactly what a HEALTHY pass looks like
 * between claiming its batch and pushing the first branch. Releasing that
 * would be releasing live work; reporting it as fine would hide a real orphan.
 */
export function classifyClaim(
    facts: ClaimFacts,
    minAgeHours = DEFAULT_MIN_AGE_HOURS,
    unprovenHours = UNPROVEN_CLAIM_HOURS
): ClaimVerdict {
    const run = facts.run ?? "none";
    // Handed to the land-runner (issue #5469): the session ended at push +
    // `ready-to-land` BY DESIGN, so a dead owner here is the normal shape, not
    // a corpse. Not `stranded` (nothing to resume — the runner lands it), not
    // `orphan` (the label must stand until the merge), no cap slot.
    if (facts.hasOpenPr && facts.landQueue === "ready") {
        return {
            state: "pr-open",
            reason: "PR queued for the land-runner (`ready-to-land`) — holds no slot; the runner releases the claim at merge",
        };
    }
    // The pipeline's own pass is at work: nothing else needs reading.
    if (run === "active")
        return {
            state: "live",
            reason: "its `afk-pass` run is queued or running",
        };

    // A live owning process outranks every death reading and age rule below
    // (#2627). Note the explicit `=== true`: `null` means "we could not
    // tell", and only a POSITIVE liveness reading may hold a claim.
    const alive = facts.ownerAlive === true;
    // Death needs a POSITIVE reading too, the mirror of `alive`: a journal
    // owner provably gone, or the claim's own `afk-pass` runs all ended.
    const dead = !alive && (facts.ownerAlive === false || run === "ended");
    const died =
        facts.ownerAlive === false
            ? "owning process is gone"
            : "its `afk-pass` run ended";

    // `land-failed` is a repair pick: whoever ran it is gone unless PROVED
    // alive (the `pr-open` row cleared the owner stamp, so `null` is the
    // ordinary reading), and the next pass resumes it.
    if (facts.hasOpenPr && facts.landQueue === "failed" && !alive) {
        return {
            state: "stranded",
            reason: "the land-runner labelled its PR `land-failed` — a repair pick for the next pass; the label is NOT released",
        };
    }
    // Work that left this machine — an open PR, a pushed branch — is live
    // unless the owner is PROVABLY gone (issue #4763): a pass that pushed and
    // then ended its turn waiting (`claude -p`: the end of the turn is the
    // end of the process) held a cap slot with no time bound. `stranded` is
    // NOT `recoverable` (that work is on no remote) and NOT `orphan` (the
    // label must stand — the PR is usually one `land` away).
    if (facts.hasOpenPr || facts.hasRemoteBranch) {
        if (dead) {
            return {
                state: "stranded",
                reason: facts.hasOpenPr
                    ? `${died} and its PR is open — resume it (usually one \`land\` away); the label is NOT released`
                    : `${died} and its branch is pushed with no PR — resume the branch; the label is NOT released`,
            };
        }
        return {
            state: "live",
            reason: facts.hasOpenPr ? "open PR" : "branch pushed",
        };
    }

    if (alive) return { state: "live", reason: "owning process still alive" };

    // A local branch is work only if it holds something newer than the claim
    // (issue #6223): a stale branch matching the issue name — a long-dead
    // pass's leftover — read as "could still be implementing" for 9 h.
    const localWork =
        facts.hasLocalBranch && facts.localWorkSinceClaim !== false;
    const stale = facts.hasLocalBranch && !localWork;

    // A dead owner whose branch holds work is its own state (issue #3698),
    // and the distinction is not cosmetic: `live` hides it and `orphan`
    // releases the label while the work stays in a worktree nothing points
    // at any more. `recoverable` says the one thing an operator can act on —
    // the pass is gone, its work is not, here is the branch.
    //
    // A provably dead owner is never `live` or `suspect` on age (issue
    // #5174): the ropes below cover a pass we cannot SEE, and this one we can
    // see is gone. Whatever the commit count (the worktree may hold
    // uncommitted edits the count cannot see) it is `recoverable`; nothing
    // at all is an `orphan` at once. Both are handed to the next pass.
    if (dead && localWork) {
        const quiet = facts.worktreeQuietMinutes ?? null;
        if (quiet !== null && quiet < DEAD_OWNER_QUIET_MINUTES) {
            return {
                state: "live",
                reason: `${died} but its worktree changed ${quiet.toFixed(0)}m ago — a resumed session may be at work`,
            };
        }
        const n = facts.unpushedCommits ?? 0;
        return {
            state: "recoverable",
            reason:
                n > 0
                    ? `${died} and its local branch holds ${n} unpushed commit${n === 1 ? "" : "s"} — the next pass resumes the branch; the label is NOT released`
                    : `${died} and its local branch holds no commit (its worktree may hold uncommitted WIP) — the next pass resumes it; the label is NOT released`,
        };
    }
    if (dead && facts.ageHours * 60 >= DEAD_OWNER_FLOOR_MINUTES) {
        return {
            state: "orphan",
            reason: stale
                ? `${died}, no PR, and its local branch predates the claim (not work) — the next pass picks it up from scratch`
                : `${died}, no branch, no PR — the next pass picks it up from scratch`,
        };
    }

    // Unreadable runs or claim time: no death reading, so nothing releases.
    if (run === "unknown") {
        return {
            state: localWork ? "live" : "suspect",
            reason: `the claim's \`afk-pass\` runs or its claim time could not be read, and no owner is proved dead — unknown evidence never releases (claimed ${facts.ageHours.toFixed(1)}h ago)`,
        };
    }

    // No proof either way. A local branch with work is a pass that got as far
    // as its worktree and may legitimately implement for hours unpushed; no
    // branch here may still be a session on another machine. Both are held
    // for `unprovenHours`; past that, nothing in this loop stays unpushed.
    if (facts.ageHours < unprovenHours) {
        if (localWork) {
            return {
                state: "live",
                reason: `local branch, claimed ${facts.ageHours.toFixed(1)}h ago — could still be implementing`,
            };
        }
        return {
            state: "suspect",
            reason:
                facts.ageHours < minAgeHours
                    ? `no branch, no PR — but claimed ${facts.ageHours.toFixed(1)}h ago, which is what a healthy pass looks like before its first push`
                    : `no run of its own, no owner on record here, no pushed work${stale ? " (its local branch predates the claim)" : ""} — claimed ${facts.ageHours.toFixed(1)}h ago, but absence is not death; held until ${unprovenHours}h`,
        };
    }
    return {
        state: "orphan",
        reason: localWork
            ? `local branch never pushed, untouched for ${facts.ageHours.toFixed(0)}h — the signature of a pass killed mid-edit`
            : `no run, no owner, no pushed work for ${facts.ageHours.toFixed(0)}h`,
    };
}

// ── owner liveness: joining a claim to an OS process (#2627) ───────────────
//
// THE PROBLEM. A claim is a GitHub label, and nothing about a label says which
// process took it. The claim journal (`.claude/telemetry/claims.jsonl`) keys
// rows by Claude Code SESSION UUID; the only liveness primitive anywhere on
// disk is the single GLOBAL driver pid (`loop-drain.pid`), and that answers
// "is SOME pass running", not "is THIS claim's pass running". Conflating the
// two protects every stale claim for as long as the driver keeps running —
// precisely the bug #2627 is about.
//
// WHY NOT DERIVE IT AFTER THE FACT. Two routes were tried and are dead ends:
//   * `lsof` on the session transcript (`~/.claude/projects/<slug>/<uuid>.jsonl`)
//     would be a true UUID→pid join needing no new bookkeeping. Measured
//     2026-08-25 against three live sessions: Claude Code holds NO open
//     descriptor on its transcript (`lsof -p <pid> | grep '\.jsonl'` is empty).
//     There is nothing to look up.
//   * the session UUID appears nowhere in the process's argv, so `pgrep -f`
//     cannot find it either.
//
// SO THE JOIN IS RECORDED, NOT DERIVED. `.claude/hooks/claim-ledger.sh` already
// runs inside the claiming session at the exact moment of the claim; it now
// walks its own process ancestry to the nearest `claude` process and writes
// `owner: {pid, startedAt}` onto the claim row. `startedAt` is the process's
// start timestamp (`ps -o lstart=`) and exists solely to defeat PID REUSE: a
// recycled pid is a DIFFERENT process with a different start time, and without
// that column a dead pass would look alive again as soon as the OS handed its
// number to something else.
//
// Everything here degrades to `null` — "unknown", which changes no verdict —
// rather than to `false`, because `false` is the reading that authorises a
// release.

/** The process that took a claim, as recorded on its journal row. */
export type ClaimOwner = {
    session: string;
    pid: number;
    /** `ps -o lstart=` at claim time — the PID-reuse discriminator. */
    startedAt: string;
};

/**
 * Probe one pid. Returns the process's start timestamp, `""` when there is no
 * such process, and `null` when the probe itself could not answer (no `ps`,
 * an unexpected exit) — the "unknown" reading that must never release.
 *
 * Injectable for the same reason `defaultIsAlive` is in `lib/loop-status.ts`:
 * tests must not need real processes to exercise the liveness branches.
 */
export type ProcessProbe = (pid: number) => string | null;

/**
 * The exit-code mapping of `ps -o lstart= -p N`, split out from the spawn so
 * every branch is reachable from a test. Three readings, and mixing up the
 * last two is the whole risk: "no such process" AUTHORISES a release, while
 * "the probe failed" must not.
 *
 *   - `ps` missing / could not run  → `null` (unknown)
 *   - exit 0 with a stamp           → the stamp
 *   - exit 1 (nothing matched)      → `""` (no such process)
 *   - any other non-zero exit       → `null` (unknown)
 *
 * Exit 0 with EMPTY output is `null` too: `ps` claiming success while telling
 * us nothing is not evidence that a process is gone.
 */
export function interpretPsResult(r: {
    error?: unknown;
    status: number | null;
    stdout?: string | null;
}): string | null {
    if (r.error) return null;
    if (r.status === 0) {
        const out = (r.stdout ?? "").trim();
        return out === "" ? null : out;
    }
    if (r.status === 1) return "";
    return null;
}

/**
 * `LC_ALL=C TZ=UTC` IS LOAD-BEARING, and is byte-identical to the WRITE side
 * (`.claude/hooks/claim-ledger.sh`). `ps -o lstart=` renders a human string
 * through the caller's locale AND timezone — measured on one machine, same
 * process, same instant: `Tue Aug 25 09:15:42 2026` by default,
 * `Di. 25 Aug. 09:15:42 2026` under `LC_TIME=de_DE`,
 * `Tue Aug 25 07:15:42 2026` under `TZ=UTC`.
 *
 * `isOwnerAlive` compares the two stamps as exact trimmed strings, so a
 * `LANG`/`TZ` divergence between the claiming shell and this reader would make
 * a LIVE owner compare unequal and read as a recycled pid. That direction is
 * safe (the claim just falls back to the age thresholds — pre-#2627
 * behaviour), which is precisely why it would never be noticed: the feature
 * would simply stop holding live claims. Fixing both ends to one locale and
 * one zone removes the divergence. DST does not enter into it — a fixed
 * instant rendered in a fixed zone is a fixed string.
 */
export const defaultProcessProbe: ProcessProbe = (pid) =>
    interpretPsResult(
        spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
            encoding: "utf8",
            env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
        })
    );

/**
 * Fold the claim journal into "who owns each issue's CURRENT claim".
 *
 * Pure over the file's text so it is testable without a filesystem. Last row
 * per issue wins: a `released` row clears the owner (whatever holds the label
 * now was not recorded here), and a `claim` row with no `owner` — every row
 * written before #2627 — yields `null`, i.e. unknown.
 *
 * Malformed lines are skipped rather than thrown on: this journal is appended
 * to by a shell hook under `2>/dev/null`, so a torn last line is a normal
 * thing to find, and refusing to sweep because of one is worse than ignoring
 * it (the rest of the fold is still sound, and an unknown owner is safe).
 */
export function parseClaimOwners(ledgerText: string): Map<number, ClaimOwner> {
    const owners = new Map<number, ClaimOwner>();
    for (const line of ledgerText.split("\n")) {
        if (line.trim() === "") continue;
        let row: {
            session?: unknown;
            issue?: unknown;
            event?: unknown;
            owner?: { pid?: unknown; startedAt?: unknown } | null;
        };
        try {
            row = JSON.parse(line);
        } catch {
            continue;
        }
        if (typeof row.issue !== "number") continue;
        if (row.event !== "claim") {
            owners.delete(row.issue);
            continue;
        }
        owners.delete(row.issue);
        const owner = row.owner;
        if (
            owner &&
            typeof owner.pid === "number" &&
            Number.isInteger(owner.pid) &&
            owner.pid > 0 &&
            typeof owner.startedAt === "string" &&
            owner.startedAt !== ""
        ) {
            owners.set(row.issue, {
                session: typeof row.session === "string" ? row.session : "",
                pid: owner.pid,
                startedAt: owner.startedAt,
            });
        }
    }
    return owners;
}

/**
 * Is the recorded owner still running? Tri-state, matching
 * `ClaimFacts.ownerAlive`: `null` whenever we cannot tell.
 */
export function isOwnerAlive(
    owner: ClaimOwner | undefined,
    probe: ProcessProbe = defaultProcessProbe
): boolean | null {
    if (!owner) return null; // no recorded owner → unknown
    const startedAt = probe(owner.pid);
    if (startedAt === null) return null; // probe unavailable → unknown
    if (startedAt === "") return false; // no such process → dead
    // Same pid, different start time = the number was recycled. The claim's
    // real owner is gone.
    return startedAt.trim() === owner.startedAt.trim();
}

/** Where the claim journal lives — the same path the hooks write. */
export function claimLedgerPath(
    root = process.env.CLAUDE_PROJECT_DIR ?? "."
): string {
    return `${root}/.claude/telemetry/claims.jsonl`;
}

/**
 * The audit row a release writes back to the claim journal (#2627 AC5).
 *
 * It goes into `claims.jsonl` rather than a new file on purpose: that journal
 * is already the record of who took what, `claim-sweep.sh` already folds
 * `released` rows out of a session's outstanding set, and stamping the row
 * with the OWNING session (not `loop:doctor`) means the dead session's own
 * SessionEnd sweep — if it ever runs — sees the claim as already released.
 * `by` and `reason` are what an operator reads to answer "what reclaimed this,
 * and on what evidence".
 */
export function releaseRecord(
    issue: number,
    verdict: ClaimVerdict,
    owner: ClaimOwner | undefined,
    now: number = Date.now()
): string {
    return JSON.stringify({
        ts: Math.floor(now / 1000),
        session: owner?.session || "loop:doctor",
        issue,
        event: "released",
        by: "loop:doctor",
        verdict: verdict.state,
        reason: verdict.reason,
    });
}

// bun auto-loads `.env.local`, whose GITHUB_TOKEN shadows the gh keyring and
// 403s every call — same trap as the docs lane and the worktree GC.
const NET_ENV: NodeJS.ProcessEnv = (() => {
    const env = { ...process.env };
    delete env.GITHUB_TOKEN;
    return env;
})();

function spawnRaw(
    cmd: string,
    args: string[]
): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(cmd, args, { encoding: "utf8", env: NET_ENV });
    return {
        status: r.status,
        stdout: r.stdout ?? "",
        stderr: r.stderr || r.error?.message || "",
    };
}

/** A pluggable command runner — the seam `loop:status` (#2519 round 3,
 *  finding 5) injects a fixture into for testing, and swaps for
 *  `shChecked` in production to turn a failed `gh`/`git` call into a
 *  thrown error instead of a silently-empty string. */
export type ShRunner = (cmd: string, args: string[]) => string;

/** Historical behaviour: a non-zero exit renders as `""`. Fine for
 *  `loop:doctor`'s own CLI, where a failed read degrading to "nothing to
 *  report" is an acceptable (if imperfect) default — NOT fine for a
 *  caller that must distinguish "the read failed" from "the read
 *  legitimately returned nothing", because both look identical here. */
const sh: ShRunner = (cmd, args) => {
    const r = spawnRaw(cmd, args);
    return r.status === 0 ? r.stdout.trim() : "";
};

/** The fail-CLOSED counterpart: throws, carrying the process's stderr,
 *  instead of returning `""` on a non-zero exit. `""` is indistinguishable
 *  from "the command succeeded and printed nothing" — the exact shape of
 *  the bug in #2519 round 3 finding 5, where a rate-limited `gh issue list`
 *  rendered as "0 claimed issues" rather than "unavailable". */
export const shChecked: ShRunner = (cmd, args) => {
    const r = spawnRaw(cmd, args);
    if (r.status !== 0) {
        throw new Error(
            `${cmd} ${args.join(" ")} failed: ${r.stderr.trim() || `exit ${r.status}`}`
        );
    }
    return r.stdout.trim();
};

/** Raw shape of one row of `gh issue list --json number,title,updatedAt`,
 *  plus the claim time when the caller read it (`fetchClaimTimes`, issue
 *  #6223): `null` / absent = unknown. */
export type ClaimedIssue = {
    number: number;
    title: string;
    updatedAt: string;
    claimedAt?: string | null;
};

/**
 * Every issue currently claimed (`is:open is:issue label:in-progress`).
 *
 * Exported (#2519) so `loop:status` builds its "who is claimed" view from the
 * SAME query `loop:doctor` uses to find orphans, rather than a second,
 * independently-drifting definition of "claimed".
 *
 * `runner` defaults to the swallow-on-failure `sh` — unchanged behaviour for
 * `loop:doctor`'s own CLI below. `loop:status` passes `shChecked` explicitly
 * so a failed read THROWS instead of reading as zero claims.
 */
export function fetchClaimedIssues(runner: ShRunner = sh): ClaimedIssue[] {
    return JSON.parse(
        runner("gh", [
            "issue",
            "list",
            "--search",
            "is:open is:issue label:in-progress",
            "--json",
            "number,title,updatedAt",
            "--limit",
            "200",
        ]) || "[]"
    ) as ClaimedIssue[];
}

/**
 * Open `ready-for-agent` issues nobody claims — the candidates whose orphaned
 * worktree `loop:doctor` reports (issue #5531). Advisory, so it never takes
 * the claim sweep down: an answer that is not a JSON array (an error body, a
 * rate-limit message, a stub) reads as none, with a warning so a broken `gh`
 * never reads as "no orphans" (issue #5551).
 */
export function fetchUnclaimedIssues(runner: ShRunner = sh): Set<number> {
    let rows: unknown;
    try {
        rows = JSON.parse(
            runner("gh", [
                "issue",
                "list",
                "--label",
                "ready-for-agent",
                "--state",
                "open",
                "--json",
                "number,labels",
                "--limit",
                "500",
            ]) || "[]"
        );
    } catch {
        console.warn(
            "loop:doctor: the unclaimed-issue list was not JSON — orphan worktrees not reported this run"
        );
        return new Set();
    }
    if (!Array.isArray(rows)) {
        console.warn(
            "loop:doctor: the unclaimed-issue list was not an array — orphan worktrees not reported this run"
        );
        return new Set();
    }
    return new Set(
        (rows as { number: number; labels?: { name: string }[] }[])
            .filter(
                (i) =>
                    Number.isInteger(i?.number) &&
                    !(i.labels ?? []).some((l) => l.name === "in-progress")
            )
            .map((i) => i.number)
    );
}

/** Head branch names of every currently OPEN pull request. See
 *  `fetchClaimedIssues` for the `runner` default/override convention. */
export function fetchOpenPrBranches(runner: ShRunner = sh): Set<string> {
    return new Set(fetchOpenPrs(runner).keys());
}

/** Open PRs, head branch → PR number (`null` when the read carried none).
 *  The number is what a `stranded` claim is surfaced by (issue #4763): the
 *  operator — or the next pass — acts on a PR, not on a branch name. */
export function fetchOpenPrs(
    runner: ShRunner = sh
): Map<string, number | null> {
    return openPrMap(fetchOpenPrRows(runner));
}

/** One open PR as `fetchOpenPrRows` reads it. */
export type OpenPrRow = {
    headRefName: string;
    number?: unknown;
    labels?: { name?: unknown }[];
};

/** Every open PR, with the labels the land-runner's queue lives in
 *  (issue #5469) — ONE `gh pr list` feeds both `fetchOpenPrs` and
 *  `landQueueByBranch`. */
export function fetchOpenPrRows(runner: ShRunner = sh): OpenPrRow[] {
    return JSON.parse(
        runner("gh", [
            "pr",
            "list",
            "--state",
            "open",
            "--limit",
            "300",
            "--json",
            "headRefName,number,labels",
        ]) || "[]"
    ) as OpenPrRow[];
}

export function openPrMap(rows: OpenPrRow[]): Map<string, number | null> {
    return new Map(
        rows.map((p) => [
            p.headRefName,
            Number.isInteger(p.number) ? (p.number as number) : null,
        ])
    );
}

/** Head branch → land-queue state, for the PRs that carry one of the
 *  runner's labels (issue #5469). `land-failed` wins over a stale
 *  `ready-to-land` left beside it: the failure is the newer fact. */
export function landQueueByBranch(
    rows: OpenPrRow[]
): Map<string, LandQueueState> {
    const out = new Map<string, LandQueueState>();
    for (const p of rows) {
        const names = (p.labels ?? []).map((l) => l.name);
        if (names.includes(FAILED_LABEL)) out.set(p.headRefName, "failed");
        else if (names.includes(READY_LABEL)) out.set(p.headRefName, "ready");
    }
    return out;
}

/** The land-queue state of the PR whose head branch ends in `issue-N`. */
export function landQueueFor(
    issue: number,
    queue: Map<string, LandQueueState>
): LandQueueState | null {
    const suffix = new RegExp(`(^|/)issue-${issue}$`);
    for (const [branch, state] of queue) if (suffix.test(branch)) return state;
    return null;
}

/** The open PR whose head branch ends in `issue-N` — the same suffix rule
 *  `buildClaimFacts` uses for `hasOpenPr`, so the two cannot disagree. */
export function openPrFor(
    issue: number,
    prs: Map<string, number | null>
): number | null {
    const suffix = new RegExp(`(^|/)issue-${issue}$`);
    for (const [branch, pr] of prs) if (suffix.test(branch)) return pr;
    return null;
}

/**
 * Branch names, kept in TWO buckets rather than one merged list.
 *
 * The merge is what hid the bug this split fixes: a local branch and a pushed
 * one are opposite signals about whether anyone is still working, and pouring
 * them into one array threw that away. `git branch --all` alone would not do
 * either, since it reports `origin/*` remote-tracking refs that can be stale;
 * `ls-remote` is the authority on what the remote actually has.
 *
 * See `fetchClaimedIssues` for the `runner` default/override convention.
 */
export function fetchBranchNames(runner: ShRunner = sh): BranchNames {
    return {
        local: runner("git", ["branch", "--format=%(refname:short)"]).split(
            "\n"
        ),
        remote: runner("git", ["ls-remote", "--heads", "origin"])
            .split("\n")
            .map((l) => l.split("\t")[1] ?? ""),
    };
}

/**
 * Turn one claimed issue plus the two branch/PR scans into the `ClaimFacts`
 * `classifyClaim` consumes. Pure — the scans themselves are the only I/O.
 */
export function buildClaimFacts(
    issue: ClaimedIssue,
    prBranches: Set<string>,
    branches: BranchNames,
    now: number = Date.now(),
    /**
     * Owner liveness, gathered by the caller — the process check is I/O and
     * `classifyClaim` stays pure. Defaults to `null` ("unknown"), so every
     * existing caller keeps exactly the verdicts it had before #2627.
     */
    ownerAlive: boolean | null = null,
    /**
     * Commits on this claim's local-only branch, gathered by the caller for
     * the same reason `ownerAlive` is — counting them is I/O. Defaults to
     * `null` ("unknown"), so every existing caller keeps exactly the verdicts
     * it had before issue #3698.
     */
    unpushedCommits: number | null = null,
    /** `ClaimFacts.worktreeQuietMinutes`, gathered by the caller (I/O). */
    worktreeQuietMinutes: number | null = null
): ClaimFacts {
    const suffix = new RegExp(`(^|/)issue-${issue.number}$`);
    const matches = (names: string[]): boolean =>
        names.some((b) => suffix.test(b.replace(/^refs\/heads\//, "")));
    const hasRemoteBranch = matches(branches.remote);
    return {
        issue: issue.number,
        title: issue.title,
        hasRemoteBranch,
        // Local-ONLY: a pushed branch exists in both buckets, and it is the
        // remote that decides. Reporting it as local too would make every
        // healthy claim look like the dead shape.
        hasLocalBranch: !hasRemoteBranch && matches(branches.local),
        hasOpenPr: [...prBranches].some((b) => suffix.test(b)),
        ageHours: (now - claimTimeMs(issue)) / (1000 * 60 * 60),
        ownerAlive,
        unpushedCommits,
        worktreeQuietMinutes,
    };
}

/** When the claim was taken, in ms: its label event, else `updatedAt` (never
 *  older than the claim — see `ClaimFacts.ageHours`). */
function claimTimeMs(issue: ClaimedIssue): number {
    const at = issue.claimedAt ? Date.parse(issue.claimedAt) : NaN;
    return Number.isFinite(at) ? at : new Date(issue.updatedAt).getTime();
}

/**
 * Does the local-only branch for `issue` hold work newer than `sinceMs`, the
 * claim time (issue #6223)? A commit past `baseRef` committed after the
 * claim, or an uncommitted path in its worktree modified after it. The
 * branch's own index is NOT work — `wt:new` writes it before a line exists.
 * `null` on every failure shape: unknown is read as work, never released.
 */
export function localWorkSince(
    issue: number,
    sinceMs: number,
    localBranches: string[],
    baseRef: string,
    runner: ShRunner = shChecked,
    mtimeMs: (path: string) => number | null = statMtimeMs
): boolean | null {
    const suffix = new RegExp(`(^|/)issue-${issue}$`);
    const branch = localBranches
        .map((b) => b.replace(/^refs\/heads\//, "").trim())
        .find((b) => b.length > 0 && suffix.test(b));
    if (!branch || !Number.isFinite(sinceMs)) return null;
    try {
        const ct = runner("git", [
            "log",
            "-1",
            "--format=%ct",
            `${baseRef}..${branch}`,
        ]).trim();
        if (ct !== "") {
            const at = Number(ct) * 1000;
            if (!Number.isFinite(at)) return null;
            if (at >= sinceMs) return true;
        }
        let path: string | null = null;
        let current: string | null = null;
        for (const line of runner("git", [
            "worktree",
            "list",
            "--porcelain",
        ]).split("\n")) {
            if (line.startsWith("worktree ")) current = line.slice(9);
            else if (line === `branch refs/heads/${branch}`) path = current;
        }
        if (path === null) return false;
        const status = runner("git", ["-C", path, "status", "--porcelain"]);
        for (const line of status.split("\n")) {
            const rel = line.slice(3).split(" -> ").pop()?.trim();
            if (!rel) continue;
            const m = mtimeMs(`${path}/${rel}`);
            if (m !== null && m >= sinceMs) return true;
        }
        return false;
    } catch {
        return null;
    }
}

/**
 * When each claim was taken: the newest `in-progress` label event of every
 * claimed issue, in ONE GraphQL search (issue #6223) — a per-issue events
 * read would cost the queue verbs a round-trip per claim. Missing from the
 * answer, or the read failed → `null` (unknown: no run is attributed to it,
 * and no local branch is judged stale against it).
 */
export function fetchClaimTimes(
    issues: readonly number[],
    runner: ShRunner = shChecked,
    repo = "{owner}/{repo}"
): Record<number, string | null> {
    const out: Record<number, string | null> = {};
    for (const n of issues) out[n] = null;
    if (issues.length === 0) return out;
    let text: string;
    try {
        text = runner("gh", [
            "api",
            "graphql",
            "-F",
            `q=repo:${repo} is:open is:issue label:in-progress`,
            "-f",
            `query=query($q:String!){search(query:$q,type:ISSUE,first:100){nodes{... on Issue{number timelineItems(itemTypes:[LABELED_EVENT],last:100){nodes{... on LabeledEvent{createdAt label{name}}}}}}}}`,
        ]);
    } catch {
        return out;
    }
    return { ...out, ...parseClaimTimes(text, issues) };
}

/** `fetchClaimTimes`' answer, folded — pure, so a fixture can pin it. */
export function parseClaimTimes(
    text: string,
    issues: readonly number[]
): Record<number, string | null> {
    const out: Record<number, string | null> = {};
    let nodes: unknown;
    try {
        nodes = (
            JSON.parse(text) as {
                data?: { search?: { nodes?: unknown } };
            }
        ).data?.search?.nodes;
    } catch {
        return out;
    }
    if (!Array.isArray(nodes)) return out;
    const wanted = new Set(issues);
    for (const node of nodes as {
        number?: unknown;
        timelineItems?: {
            nodes?: { createdAt?: unknown; label?: { name?: unknown } }[];
        };
    }[]) {
        if (typeof node?.number !== "number" || !wanted.has(node.number))
            continue;
        const times = (node.timelineItems?.nodes ?? [])
            .filter(
                (e) =>
                    e?.label?.name === CLAIM_LABEL &&
                    typeof e.createdAt === "string"
            )
            .map((e) => e.createdAt as string);
        out[node.number] = times.length ? times[times.length - 1] : null;
    }
    return out;
}

/** The `afk-pass` runs (issue #6223), newest first — the dispatcher's own
 *  `gh run list` shape. `null` when unreadable: every claim's run evidence
 *  is then `unknown`, which releases nothing. */
export function fetchPassRuns(
    runner: ShRunner = shChecked
): WorkflowRun[] | null {
    try {
        return parseWorkflowRuns(
            runner("gh", [
                "run",
                "list",
                "--workflow",
                PASS_WORKFLOW,
                "--limit",
                "200",
                "--json",
                WORKFLOW_RUN_FIELDS,
            ])
        );
    } catch {
        return null;
    }
}

/**
 * Minutes since the claim's worktree last changed (issue #5174): the newest
 * mtime among its index and every path `git status` names. The worktree is
 * found by BRANCH (`git worktree list`), so its directory name is irrelevant.
 * `null` on every failure shape and when no worktree holds the branch.
 */
export function worktreeQuietMinutes(
    issue: number,
    now: number,
    runner: ShRunner = shChecked,
    mtimeMs: (path: string) => number | null = statMtimeMs
): number | null {
    const suffix = new RegExp(`(^|/)issue-${issue}$`);
    let list: string;
    try {
        list = runner("git", ["worktree", "list", "--porcelain"]);
    } catch {
        return null;
    }
    let path: string | null = null;
    let current: string | null = null;
    for (const line of list.split("\n")) {
        if (line.startsWith("worktree ")) current = line.slice(9);
        else if (
            line.startsWith("branch ") &&
            suffix.test(line.slice(7).replace(/^refs\/heads\//, ""))
        )
            path = current;
    }
    if (path === null) return null;
    let newest: number | null = null;
    const see = (p: string): void => {
        const m = mtimeMs(p);
        if (m !== null && (newest === null || m > newest)) newest = m;
    };
    try {
        const index = runner("git", [
            "-C",
            path,
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "index",
        ]).trim();
        if (index) see(index);
        const status = runner("git", ["-C", path, "status", "--porcelain"]);
        for (const line of status.split("\n")) {
            const rel = line.slice(3).split(" -> ").pop()?.trim();
            if (rel) see(`${path}/${rel}`);
        }
    } catch {
        return null;
    }
    if (newest === null) return null;
    return Math.max(0, (now - newest) / 60000);
}

function statMtimeMs(path: string): number | null {
    try {
        return statSync(path).mtimeMs;
    } catch {
        return null;
    }
}

/**
 * How many commits the local-only branch for `issue` carries that exist
 * nowhere else (issue #3698).
 *
 * `null` on every failure shape — no such branch, no such base ref, a `git`
 * that could not run, output that is not a number. `classifyClaim` treats
 * `null` as "unknown" and changes no verdict on it, so a repo where this
 * cannot be read behaves exactly as it did before.
 *
 * The base ref is passed in rather than read here: `scripts/lib/branches.ts`
 * is the only module allowed to resolve the configured base branch (ADR 0116),
 * and a literal `origin/main` anywhere else reds `branches.test.ts`.
 */
export function countUnpushedCommits(
    issue: number,
    localBranches: string[],
    baseRef: string,
    /**
     * `shChecked`, not the swallow-on-failure `sh` every other reader here
     * defaults to. `sh` renders a non-zero exit as `""`, and `Number("")` is
     * `0` — so a missing base ref or a bad branch name would answer "this
     * branch has no unpushed work" instead of "unknown", which is the exact
     * confusion `null` exists to avoid. The `catch` below turns the throw back
     * into `null`.
     */
    runner: ShRunner = shChecked
): number | null {
    const suffix = new RegExp(`(^|/)issue-${issue}$`);
    const branch = localBranches
        .map((b) => b.replace(/^refs\/heads\//, "").trim())
        .find((b) => b.length > 0 && suffix.test(b));
    if (!branch) return null;
    let out: string;
    try {
        out = runner("git", ["rev-list", "--count", `${baseRef}..${branch}`]);
    } catch {
        return null;
    }
    const n = Number(out.trim());
    return Number.isInteger(n) && n >= 0 ? n : null;
}

// ── the classification pipeline, shared with the queue verbs (issue #4384) ──
//
// THE BUG THIS EXISTS FOR. The session cap counted LABELS. `queue:claim` and
// `queue:plan` built their live set from the `in-progress` labels minus an
// open PR minus 24 hours of silence, and that path held no process-liveness
// evidence at all — while this file's classifier had it, and had already
// printed the right diagnosis. Observed 2026-09-22: two `loop-drain` passes
// died mid-issue leaving three claims standing (#4117, #4306, #4307), `ps`
// showed ZERO owning processes, `loop:doctor` reported `2 RECOVERABLE`, and
// the next claim was still refused at `3/3 live claims`. Real concurrent
// sessions: none. The cap measures ACTIVE sessions (the PR/h knee,
// `docs/agents/quality-gates.md` § Session admission); it was counting
// corpses.
//
// So the verdict is exported rather than re-derived. The discipline is the one
// `loop-drain.test.ts` already enforces for staleness: ONE definition, imported.
// A second opinion in the queue verbs is how the two ends drift.

export type ClaimClassification = {
    issue: number;
    title: string;
    verdict: ClaimVerdict;
    /** The claim's open PR, when `deps.prs` was given and one matched —
     *  how a `stranded` claim is surfaced (issue #4763). */
    pr: number | null;
};

/**
 * Pure: every claim's verdict, from facts the caller gathered. The CLI below
 * and both queue verbs run exactly this, so "live" means one thing on this
 * machine.
 */
export function classifyClaims(
    issues: ClaimedIssue[],
    deps: {
        prBranches: Set<string>;
        /** Head branch → PR number (`fetchOpenPrs`); only names `pr`. */
        prs?: Map<string, number | null>;
        /** Head branch → land-queue state (`landQueueByBranch`, issue #5469). */
        landQueue?: Map<string, LandQueueState>;
        branches: BranchNames;
        owners: Map<number, ClaimOwner>;
        baseRef: string;
        now?: number;
        probe?: ProcessProbe;
        /** The runner `countUnpushedCommits` uses — the tests' seam. */
        countRunner?: ShRunner;
        /** `worktreeQuietMinutes` — the tests' seam. */
        worktreeQuiet?: (issue: number, now: number) => number | null;
        /**
         * The `afk-pass` runs (`fetchPassRuns`, issue #6223): `null` =
         * unreadable (every claim's run evidence `unknown`); absent = not
         * read (no pipeline evidence, `ClaimFacts.run` absent).
         */
        passRuns?: readonly WorkflowRun[] | null;
        /** `localWorkSince` — the tests' seam. */
        localWork?: (issue: number, sinceMs: number) => boolean | null;
    }
): ClaimClassification[] {
    const now = deps.now ?? Date.now();
    return issues.map((issue) => {
        const owner = deps.owners.get(issue.number);
        const facts = buildClaimFacts(
            issue,
            deps.prBranches,
            deps.branches,
            now,
            isOwnerAlive(owner, deps.probe),
            countUnpushedCommits(
                issue.number,
                deps.branches.local,
                deps.baseRef,
                deps.countRunner
            )
        );
        if (deps.landQueue)
            facts.landQueue = landQueueFor(issue.number, deps.landQueue);
        const claimedAt = issue.claimedAt ?? null;
        if (deps.passRuns !== undefined)
            facts.run =
                deps.passRuns === null
                    ? "unknown"
                    : passRunEvidence(issue.number, deps.passRuns, claimedAt);
        // Against an unknown claim time no branch can be judged stale: it
        // stays work (`null`), the reading that releases nothing.
        if (facts.hasLocalBranch)
            facts.localWorkSinceClaim =
                claimedAt === null
                    ? null
                    : (
                          deps.localWork ??
                          ((n: number, since: number) =>
                              localWorkSince(
                                  n,
                                  since,
                                  deps.branches.local,
                                  deps.baseRef,
                                  deps.countRunner
                              ))
                      )(issue.number, Date.parse(claimedAt));
        // Read only where it can move a verdict: `git status` per claim is
        // not free, and only a dead owner's local branch consults it.
        if (
            (facts.ownerAlive === false || facts.run === "ended") &&
            facts.hasLocalBranch
        )
            facts.worktreeQuietMinutes = (
                deps.worktreeQuiet ?? worktreeQuietMinutes
            )(issue.number, now);
        return {
            issue: issue.number,
            title: issue.title,
            verdict: classifyClaim(facts),
            pr: deps.prs ? openPrFor(issue.number, deps.prs) : null,
        };
    });
}

/** The claim journal, folded to owners. Missing or unreadable → an empty map,
 *  i.e. every claim reads `ownerAlive: null` (unknown) and no verdict moves. */
export function readClaimOwners(
    root = process.env.CLAUDE_PROJECT_DIR ?? "."
): Map<number, ClaimOwner> {
    try {
        return parseClaimOwners(readFileSync(claimLedgerPath(root), "utf8"));
    } catch {
        return new Map();
    }
}

/**
 * The I/O wrapper the queue verbs call: issue number → verdict state, over
 * the same scans `loop:doctor` runs.
 *
 * TOTAL BY CONTRACT, and the direction is the safe one. Every read here can
 * fail — `git ls-remote` needs the network, `gh pr list` can be rate-limited,
 * a worktree may have no journal — and a failure yields an EMPTY map, which
 * the census reads as "no evidence" and therefore as live. A broken probe can
 * only ever make the cap stricter, never let a session past it.
 *
 * `shChecked` IS THAT CONTRACT, and the default the CLI uses would break it.
 * `sh` renders a non-zero exit as `""`, so `JSON.parse("" || "[]")` is an
 * empty PR set and `"".split("\n")` an empty remote-branch list — indis-
 * tinguishable from "no open PRs and no pushed branches". The `catch` below
 * would never fire, and `classifyClaim` would form REAL verdicts from
 * degraded data. That is not academic: a healthy claim whose session pushed
 * its branch, opened a PR and then exited normally is `live` ONLY via the
 * `hasOpenPr` / `hasRemoteBranch` checks. Lose both reads at once — one
 * network outage reaches `gh` and `git ls-remote` alike — and it falls
 * through to dead-owner-with-local-commits and classifies `recoverable`,
 * which `capCensus` then excludes from the cap. A failed read would have made
 * the cap LOOSER, the one direction this whole design forbids. Throwing is
 * what turns that into the documented empty map.
 */
export function claimVerdicts(
    issues: ClaimedIssue[],
    baseRef: string,
    root = process.env.CLAUDE_PROJECT_DIR ?? ".",
    now: number = Date.now(),
    /** Fail-CLOSED by default — see the paragraph above. The tests' seam. */
    runner: ShRunner = shChecked
): Map<number, ClaimVerdictState> {
    return new Map(
        claimClassifications(issues, baseRef, root, now, runner).map((c) => [
            c.issue,
            c.verdict.state,
        ])
    );
}

/**
 * `claimVerdicts`' full rows — verdict AND the open PR — for the caller that
 * must NAME a stranded claim's PR (`queue:plan`'s `resume` list, issue
 * #4763). Same scans, same fail-closed contract: any failed read → `[]`.
 */
export function claimClassifications(
    issues: ClaimedIssue[],
    baseRef: string,
    root = process.env.CLAUDE_PROJECT_DIR ?? ".",
    now: number = Date.now(),
    runner: ShRunner = shChecked
): ClaimClassification[] {
    if (issues.length === 0) return [];
    try {
        const rows = fetchOpenPrRows(runner);
        const prs = openPrMap(rows);
        return classifyClaims(withClaimTimes(issues, runner), {
            prBranches: new Set(prs.keys()),
            prs,
            landQueue: landQueueByBranch(rows),
            branches: fetchBranchNames(runner),
            owners: readClaimOwners(root),
            baseRef,
            now,
            countRunner: runner,
            passRuns: fetchPassRuns(runner),
        });
    } catch {
        return [];
    }
}

/** `issues`, each with its claim time read (`fetchClaimTimes`); a time
 *  the caller already holds is kept. */
export function withClaimTimes(
    issues: ClaimedIssue[],
    runner: ShRunner = shChecked,
    repo?: string
): ClaimedIssue[] {
    const times = fetchClaimTimes(
        issues.map((i) => i.number),
        runner,
        repo
    );
    return issues.map((i) => ({
        ...i,
        claimedAt: i.claimedAt ?? times[i.number] ?? null,
    }));
}

if (import.meta.main) {
    const release = process.argv.includes("--release");

    const issues = withClaimTimes(fetchClaimedIssues());

    // Unclaimed issues whose worktree still holds unpushed commits (issue
    // #5531) — invisible to the claim roster below. Reported, never released.
    const unclaimed = fetchUnclaimedIssues();
    for (const o of orphanWorktrees(unclaimed, {
        baseRef: ORIGIN_BASE,
        owners: readClaimOwners(
            process.env.CLAUDE_PROJECT_DIR ?? primaryCheckout()
        ),
    }))
        console.log(
            o.verdict.state === "adopt"
                ? `  ! #${o.issue} ORPHAN WORKTREE ${o.path} — ${o.verdict.reason}`
                : `  ? #${o.issue} HELD ORPHAN WORKTREE — ${o.verdict.reason}`
        );

    if (issues.length === 0) {
        console.log("loop:doctor — no claimed issues. Nothing to check.");
        process.exit(0);
    }

    const prRows = fetchOpenPrRows();
    const prs = openPrMap(prRows);
    const branches = fetchBranchNames();

    // The claim journal is the only place a claim's owning process is named.
    // Missing file → an empty map → every claim reads `ownerAlive: null`
    // (unknown), i.e. the pre-#2627 behaviour.
    const ledgerFile = claimLedgerPath();
    const owners = readClaimOwners();
    // The dispatcher's evidence too (issue #6223): one verdict, one input.
    const passRuns = fetchPassRuns();
    if (passRuns === null)
        console.log(
            "loop:doctor: the `afk-pass` runs were unreadable — no claim is released on run evidence this run"
        );

    const orphans: { issue: number; verdict: ClaimVerdict }[] = [];
    const recoverable: { issue: number; verdict: ClaimVerdict }[] = [];
    const stranded: { issue: number; pr: number | null }[] = [];
    // The SAME call the queue verbs make (issue #4384) — this CLI is not
    // allowed a private spelling of its own classification.
    for (const { issue: number, title, verdict: v, pr } of classifyClaims(
        issues,
        {
            prBranches: new Set(prs.keys()),
            prs,
            landQueue: landQueueByBranch(prRows),
            branches,
            owners,
            baseRef: ORIGIN_BASE,
            passRuns,
        }
    )) {
        const issue = { number, title };
        const mark =
            v.state === "orphan"
                ? "×"
                : v.state === "recoverable"
                  ? "!"
                  : v.state === "stranded"
                    ? "~"
                    : v.state === "suspect"
                      ? "?"
                      : v.state === "pr-open"
                        ? ">"
                        : "·";
        console.log(
            `  ${mark} #${issue.number} ${issue.title.slice(0, 52).padEnd(52)} ${v.reason}`
        );
        if (v.state === "orphan")
            orphans.push({ issue: issue.number, verdict: v });
        if (v.state === "recoverable")
            recoverable.push({ issue: issue.number, verdict: v });
        if (v.state === "stranded") stranded.push({ issue: issue.number, pr });
    }

    console.log(
        `\n${issues.length} claimed, ${orphans.length} orphaned (nothing is going to release them).`
    );
    // Reported LOUDLY and released by nothing (issue #3698). Releasing the
    // label alone would send the next pass at the same issue from scratch
    // while the dead pass's commits sit in a worktree it will then collide
    // with; the recoverable state exists to put that work back in play instead
    // of expiring it silently after 24 hours — `queue:plan` hands it to the
    // next pass as `resume` (issue #5174).
    if (recoverable.length > 0) {
        console.log(
            `\n${recoverable.length} RECOVERABLE — a dead pass left a local branch behind. Not released; the next pass resumes it:`
        );
        for (const { issue: n, verdict } of recoverable) {
            console.log(`  ! #${n} (branch *issue-${n}) — ${verdict.reason}`);
        }
    }
    // Named by PR number (issue #4763): pushed work with no process behind
    // it. Not released and not counted against the cap; `queue:plan` hands
    // it to the next pass as `resume`, and `loop-drain` resumes it first.
    if (stranded.length > 0) {
        console.log(
            `\n${stranded.length} STRANDED — a dead pass left pushed work behind. Not released; the next pass resumes it:`
        );
        for (const { issue: n, pr } of stranded) {
            console.log(
                `  ~ #${n} ${pr === null ? "(branch pushed, no PR)" : `PR #${pr}`}`
            );
        }
    }
    if (orphans.length === 0) process.exit(0);
    if (!release) {
        console.log(
            "Nothing released — re-run with --release to drop `in-progress` on the orphans."
        );
        process.exit(0);
    }
    for (const { issue: n, verdict } of orphans) {
        const ok = spawnSync("gh", releaseEditArgs(n), {
            stdio: "inherit",
            env: NET_ENV,
        }).status;
        if (ok === 0) {
            // Record BEFORE reporting, and never let a journal failure look
            // like a failed release: the label really did come off.
            try {
                appendFileSync(
                    ledgerFile,
                    `${releaseRecord(n, verdict, owners.get(n))}\n`
                );
            } catch {
                console.log(
                    `  (could not append the release record to ${ledgerFile})`
                );
            }
        }
        console.log(
            `${ok === 0 ? "released" : "FAILED"}  #${n} — ${verdict.reason}`
        );
    }
}
