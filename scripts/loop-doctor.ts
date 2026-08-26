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
import { appendFileSync, readFileSync } from "node:fs";

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
    /** Hours since the issue was last updated. */
    ageHours: number;
    /**
     * Is the OS process that took this claim still running? (#2627)
     *
     * TRI-STATE on purpose, and the third state is the important one:
     *
     *   - `true`  — a live process owns this claim. Never release it.
     *   - `false` — the owner is provably gone (its pid is dead, or the pid
     *               was recycled by a process that started at a different
     *               time). This does NOT release anything on its own: it
     *               simply stops vetoing the age-based verdicts below.
     *   - `null`  — unknown. No owner was recorded for this claim (every row
     *               written before #2627 landed), or the process probe itself
     *               was unavailable. Also does not release anything on its
     *               own — the classifier behaves exactly as it did before.
     *
     * So this fact can only ever move a verdict TOWARDS `live`, never towards
     * `orphan`. That asymmetry is deliberate: the failure mode of this whole
     * subsystem is unclaiming a healthy concurrent pass, so a liveness fact
     * we are unsure about must not be the thing that authorises a release.
     *
     * See `parseClaimOwners` / `isOwnerAlive` for how the join is made —
     * there is no pid anywhere in the GitHub API's idea of a claim, so it
     * comes from the claim journal, recorded at claim time.
     */
    ownerAlive: boolean | null;
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
export const CLAIM_VERDICT_STATES = ["live", "orphan", "suspect"] as const;

export type ClaimVerdictState = (typeof CLAIM_VERDICT_STATES)[number];

export type ClaimVerdict = { state: ClaimVerdictState; reason: string };

/**
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
    minAgeHours = 2,
    localOnlyBranchHours = 24
): ClaimVerdict {
    if (facts.hasOpenPr) return { state: "live", reason: "open PR" };
    if (facts.hasRemoteBranch)
        return { state: "live", reason: "branch pushed" };

    // A live owning process outranks every age rule below (#2627). Note the
    // explicit `=== true`: `null` means "we could not tell", and only a
    // POSITIVE liveness reading may hold a claim. See `ClaimFacts.ownerAlive`.
    if (facts.ownerAlive === true)
        return { state: "live", reason: "owning process still alive" };

    // A local-only branch gets a MUCH longer rope than no branch at all, and
    // the two thresholds are not interchangeable. A claim with no branch is
    // either seconds old (a healthy pass before `git worktree add`) or dead,
    // and two hours separates them cleanly. A claim with a local branch is a
    // pass that got as far as creating its worktree — it may legitimately be
    // implementing for hours without pushing, so releasing it at two hours
    // would unclaim live work. Past `localOnlyBranchHours` it is not a slow
    // pass: nothing in this loop stays unpushed for a day.
    if (facts.hasLocalBranch) {
        if (facts.ageHours < localOnlyBranchHours) {
            return {
                state: "live",
                reason: `local branch, claimed ${facts.ageHours.toFixed(1)}h ago — could still be implementing`,
            };
        }
        return {
            state: "orphan",
            reason: `local branch never pushed, untouched for ${facts.ageHours.toFixed(0)}h — the signature of a pass killed mid-edit`,
        };
    }

    if (facts.ageHours < minAgeHours) {
        return {
            state: "suspect",
            reason: `no branch, no PR — but claimed ${facts.ageHours.toFixed(1)}h ago, which is what a healthy pass looks like before its first push`,
        };
    }
    return {
        state: "orphan",
        reason: `no branch, no PR, untouched for ${facts.ageHours.toFixed(0)}h`,
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

/** Raw shape of one row of `gh issue list --json number,title,updatedAt`. */
export type ClaimedIssue = { number: number; title: string; updatedAt: string };

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

/** Head branch names of every currently OPEN pull request. See
 *  `fetchClaimedIssues` for the `runner` default/override convention. */
export function fetchOpenPrBranches(runner: ShRunner = sh): Set<string> {
    return new Set(
        (
            JSON.parse(
                runner("gh", [
                    "pr",
                    "list",
                    "--state",
                    "open",
                    "--limit",
                    "300",
                    "--json",
                    "headRefName",
                ]) || "[]"
            ) as { headRefName: string }[]
        ).map((p) => p.headRefName)
    );
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
    ownerAlive: boolean | null = null
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
        ageHours:
            (now - new Date(issue.updatedAt).getTime()) / (1000 * 60 * 60),
        ownerAlive,
    };
}

if (import.meta.main) {
    const release = process.argv.includes("--release");

    const issues = fetchClaimedIssues();

    if (issues.length === 0) {
        console.log("loop:doctor — no claimed issues. Nothing to check.");
        process.exit(0);
    }

    const prBranches = fetchOpenPrBranches();
    const branches = fetchBranchNames();

    // The claim journal is the only place a claim's owning process is named.
    // Missing file → an empty map → every claim reads `ownerAlive: null`
    // (unknown), i.e. the pre-#2627 behaviour.
    const ledgerFile = claimLedgerPath();
    const owners = parseClaimOwners(
        (() => {
            try {
                return readFileSync(ledgerFile, "utf8");
            } catch {
                return "";
            }
        })()
    );

    const now = Date.now();
    const orphans: { issue: number; verdict: ClaimVerdict }[] = [];
    for (const issue of issues) {
        const owner = owners.get(issue.number);
        const facts = buildClaimFacts(
            issue,
            prBranches,
            branches,
            now,
            isOwnerAlive(owner)
        );
        const v = classifyClaim(facts);
        const mark =
            v.state === "orphan" ? "×" : v.state === "suspect" ? "?" : "·";
        console.log(
            `  ${mark} #${issue.number} ${issue.title.slice(0, 52).padEnd(52)} ${v.reason}`
        );
        if (v.state === "orphan")
            orphans.push({ issue: issue.number, verdict: v });
    }

    console.log(
        `\n${issues.length} claimed, ${orphans.length} orphaned (nothing is going to release them).`
    );
    if (orphans.length === 0) process.exit(0);
    if (!release) {
        console.log(
            "Nothing released — re-run with --release to drop `in-progress` on the orphans."
        );
        process.exit(0);
    }
    for (const { issue: n, verdict } of orphans) {
        const ok = spawnSync(
            "gh",
            [
                "issue",
                "edit",
                String(n),
                "--remove-label",
                "in-progress",
                "--remove-assignee",
                "@me",
            ],
            { stdio: "inherit", env: NET_ENV }
        ).status;
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
