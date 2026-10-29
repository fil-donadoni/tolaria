/**
 * The claim verdict — what one `in-progress` claim is, and whether anything
 * is going to release it (issue #4384, issue #6223: the ONE authority).
 *
 * WHY. An issue is claimed by putting `in-progress` on it, and the claim is
 * meant to come off on every exit path. A pass that dies mid-flight never
 * releases it, and an orphaned claim is silent and permanent: every later
 * pass sees `in-progress` and skips the issue as somebody else's live work.
 * `classifyClaim` reads the evidence (branch, open PR, land queue,
 * `afk-pass` runs) and names the claim's state; `afk-dispatch`
 * releases the orphans, `queue:plan` hands recoverable and stranded work to
 * the next pass as `resume`.
 *
 * SAFE BY DEFAULT: an orphan is only a claim with NO branch and NO open PR
 * anywhere — the sessions share one GitHub account, so "assigned to me"
 * proves nothing about which session owns a claim, and a wrong release
 * unclaims live work.
 *
 * Library only: its CLI retired with the loop driver; the
 * gathering helpers stay here beside the verdict they feed.
 */
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { CLAIM_LABEL } from "./claim-labels";
import { FAILED_LABEL, READY_LABEL } from "./land-labels";
import {
    PASS_WORKFLOW,
    WORKFLOW_RUN_FIELDS,
    parseWorkflowRuns,
    passRunEvidence,
    type WorkflowRun,
} from "./afk-dispatch";

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
     * Commits on the claim's local-only branch that exist nowhere else —
     * `git rev-list --count <base>..<branch>` (issue #3698).
     *
     *   - a positive number — the dead pass got as far as COMMITTING. That
     *     work exists only in its worktree, and the 24-hour local-branch rope
     *     below is 24 hours of nobody knowing it is there.
     *   - `0` — a branch with nothing on it. `wt:new` creates one before the
     *     pass writes a line, so this is the ordinary shape of a claim that
     *     died early, and there is nothing to recover.
     *   - `null` — unknown (the count could not be read). Unknown changes no
     *     verdict: it falls through to the age rules that
     *     were there before.
     */
    unpushedCommits: number | null;
    /**
     * Minutes since anything in the claim's worktree last changed — its
     * index, or any file `git status` names (issue #5174). Read only for a
     * claim whose `afk-pass` run ended with a local branch: a session may
     * have resumed it by hand and still be editing. `null` = no worktree or
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
 * `.js` module cannot import a `.ts` source at runtime).
 */
export const DEFAULT_MIN_AGE_HOURS = 2;

/** A claim whose `afk-pass` run ended, younger than this, is still
 *  `suspect` (issue #5174): the dispatcher adds the label before it
 *  dispatches the run, and the run list can lag the claim by that instant.
 *  Minutes, not the 2 h rope — it covers a write, not a pass. */
export const DEAD_OWNER_FLOOR_MINUTES = 5;

/** A claim with no proof either way — no run of its own, no pushed work —
 *  is held this long before it reads `orphan` (issue #6223). Absence is not
 *  death: the claim may be an attended session's, or run on another
 *  machine, whose local branches nobody here can read, and a session pushes
 *  only at hand-off. Past a day it is not a slow pass —
 *  nothing in this loop stays unpushed that long. */
export const UNPROVEN_CLAIM_HOURS = 24;

/** A dead pass's worktree touched more recently than this is `live`
 *  (issue #5174) — see `ClaimFacts.worktreeQuietMinutes`. */
export const DEAD_OWNER_QUIET_MINUTES = 30;

/**
 * THE verdict on a claim (issue #6223): the queue verbs and the AFK
 * dispatcher (its picker and its hold-time release) all call this, over the union of their evidence — no caller keeps a private
 * age, branch or run rule. Before, the dispatcher judged claims by `afk-pass`
 * runs alone and this file by a journal owner and age alone, and the two
 * disagreed claim by claim: 28 claims "orphan" here sat "live" there forever.
 *
 * The evidence rules, in order:
 *   - a run named for the issue proves the pipeline owns the claim: an
 *     active one holds it, and their end proves death;
 *   - without one, the claim is judged by its pushed work — and a local
 *     branch counts as work only if it holds something newer than the claim.
 * Unknown evidence never releases: only a POSITIVE death reading (an ended
 * run) or a day of nothing at all makes an `orphan`. The claim is a label
 * (ADR 0156): no process is recorded beside it, so an attended session is
 * held by its pushed work and the day's rope alone.
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
    // `orphan` (the label must stand until the merge).
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

    // Death needs a POSITIVE reading: the claim's own `afk-pass` runs all
    // ended.
    const dead = run === "ended";
    const died = "its `afk-pass` run ended";

    // `land-failed` is a repair pick: whoever ran it is gone (an active run
    // returned above), and the next pass resumes it.
    if (facts.hasOpenPr && facts.landQueue === "failed") {
        return {
            state: "stranded",
            reason: "the land-runner labelled its PR `land-failed` — a repair pick for the next pass; the label is NOT released",
        };
    }
    // Work that left this machine — an open PR, a pushed branch — is live
    // unless its pass is PROVABLY gone (issue #4763): a pass that pushed and
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

    // A local branch is work only if it holds something newer than the claim
    // (issue #6223): a stale branch matching the issue name — a long-dead
    // pass's leftover — read as "could still be implementing" for 9 h.
    const localWork =
        facts.hasLocalBranch && facts.localWorkSinceClaim !== false;
    const stale = facts.hasLocalBranch && !localWork;

    // A dead pass whose branch holds work is its own state (issue #3698),
    // and the distinction is not cosmetic: `live` hides it and `orphan`
    // releases the label while the work stays in a worktree nothing points
    // at any more. `recoverable` says the one thing an operator can act on —
    // the pass is gone, its work is not, here is the branch.
    //
    // A provably dead pass is never `live` or `suspect` on age (issue
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
            reason: `the claim's \`afk-pass\` runs or its claim time could not be read, so no pass is proved dead — unknown evidence never releases (claimed ${facts.ageHours.toFixed(1)}h ago)`,
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
                    : `no run of its own, no pushed work${stale ? " (its local branch predates the claim)" : ""} — claimed ${facts.ageHours.toFixed(1)}h ago, but absence is not death; held until ${unprovenHours}h`,
        };
    }
    return {
        state: "orphan",
        reason: localWork
            ? `local branch never pushed, untouched for ${facts.ageHours.toFixed(0)}h — the signature of a pass killed mid-edit`
            : `no run, no pushed work for ${facts.ageHours.toFixed(0)}h`,
    };
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

/** A pluggable command runner — the seam a test injects a fixture into
 *  (#2519 round 3, finding 5), and a caller swaps for `shChecked` to turn a failed `gh`/`git` call into a
 *  thrown error instead of a silently-empty string. */
export type ShRunner = (cmd: string, args: string[]) => string;

/** Historical behaviour: a non-zero exit renders as `""`. Fine for
 *  an advisory read, where degrading to "nothing to report" is an
 *  acceptable (if imperfect) default — NOT fine for a
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
 * Exported (#2519) so every claim reader uses the SAME query, rather than a
 * second, independently-drifting definition of "claimed".
 *
 * `runner` defaults to the swallow-on-failure `sh`; a caller that must tell
 * a failed read from zero claims passes `shChecked`, which THROWS.
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
     * Commits on this claim's local-only branch, gathered by the caller —
     * counting them is I/O and `classifyClaim` stays pure. Defaults to
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
        // A path that cannot be stat'ed (a deletion, a quoted name) is an
        // edit of unknown age: unknown, never "not work".
        let unreadable = false;
        for (const line of status.split("\n")) {
            const rel = porcelainPath(line);
            if (!rel) continue;
            const m = mtimeMs(`${path}/${rel}`);
            if (m === null) unreadable = true;
            else if (m >= sinceMs) return true;
        }
        return unreadable ? null : false;
    } catch {
        return null;
    }
}

/**
 * The path of one `git status --porcelain` line (`XY path`, `XY a -> b`).
 * Parsed by its shape, not by `slice(3)`: `shChecked` trims its stdout, so
 * the FIRST line of ` M a.ts` arrives as `M a.ts` and a fixed offset cuts the
 * path's first character (issue #6223 review).
 */
export function porcelainPath(line: string): string | null {
    const m = /^\s*\S{1,2}\s+(.+)$/.exec(line);
    return m ? (m[1].split(" -> ").pop()?.trim() ?? null) || null : null;
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
            const rel = porcelainPath(line);
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

// ── the classification pipeline, shared by `queue:plan` and `afk-dispatch` ──
//
// The verdict is exported rather than re-derived (issue #4384). ONE
// definition, imported: a second opinion in a caller is how two ends drift.

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
        baseRef: string;
        now?: number;
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
        const facts = buildClaimFacts(
            issue,
            deps.prBranches,
            deps.branches,
            now,
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
        // not free, and only a dead pass's local branch consults it.
        if (facts.run === "ended" && facts.hasLocalBranch)
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

/**
 * The I/O wrapper `queue:plan` calls: every claim's verdict AND its open PR,
 * so the `resume` list can NAME a stranded claim's PR (issue #4763).
 *
 * TOTAL BY CONTRACT: any failed read → `[]`, so no claim is handed to a
 * pass on degraded data. `shChecked` IS that contract — `sh` renders a
 * non-zero exit as `""`, indistinguishable from "no open PRs and no pushed
 * branches", and a healthy pushed claim would fall through to a dead-pass
 * verdict. Throwing is what turns a lost read into the empty list.
 */
export function claimClassifications(
    issues: ClaimedIssue[],
    baseRef: string,
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
