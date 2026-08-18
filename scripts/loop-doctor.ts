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

export type ClaimFacts = {
    issue: number;
    title: string;
    /** A local or remote branch whose name ends in `issue-N`. */
    hasBranch: boolean;
    /** An open PR whose head branch ends in `issue-N`. */
    hasOpenPr: boolean;
    /** Hours since the issue was last updated. */
    ageHours: number;
};

export type ClaimVerdict =
    | { state: "live"; reason: string }
    | { state: "orphan"; reason: string }
    | { state: "suspect"; reason: string };

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
    minAgeHours = 2
): ClaimVerdict {
    if (facts.hasOpenPr) return { state: "live", reason: "open PR" };
    if (facts.hasBranch) return { state: "live", reason: "branch pushed" };
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

/** Every local AND remote branch name (local branches unprefixed; remote
 *  `origin/*` refs reduced to their short name via `ls-remote`). See
 *  `fetchClaimedIssues` for the `runner` default/override convention. */
export function fetchAllBranchNames(runner: ShRunner = sh): string[] {
    return [
        ...runner("git", [
            "branch",
            "--all",
            "--format=%(refname:short)",
        ]).split("\n"),
        ...runner("git", ["ls-remote", "--heads", "origin"])
            .split("\n")
            .map((l) => l.split("\t")[1] ?? ""),
    ];
}

/**
 * Turn one claimed issue plus the two branch/PR scans into the `ClaimFacts`
 * `classifyClaim` consumes. Pure — the scans themselves are the only I/O.
 */
export function buildClaimFacts(
    issue: ClaimedIssue,
    prBranches: Set<string>,
    allBranches: string[],
    now: number = Date.now()
): ClaimFacts {
    const suffix = new RegExp(`(^|/)issue-${issue.number}$`);
    return {
        issue: issue.number,
        title: issue.title,
        hasBranch: allBranches.some((b) =>
            suffix.test(b.replace(/^refs\/heads\//, ""))
        ),
        hasOpenPr: [...prBranches].some((b) => suffix.test(b)),
        ageHours:
            (now - new Date(issue.updatedAt).getTime()) / (1000 * 60 * 60),
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
    const allBranches = fetchAllBranchNames();

    const now = Date.now();
    const orphans: number[] = [];
    for (const issue of issues) {
        const facts = buildClaimFacts(issue, prBranches, allBranches, now);
        const v = classifyClaim(facts);
        const mark =
            v.state === "orphan" ? "×" : v.state === "suspect" ? "?" : "·";
        console.log(
            `  ${mark} #${issue.number} ${issue.title.slice(0, 52).padEnd(52)} ${v.reason}`
        );
        if (v.state === "orphan") orphans.push(issue.number);
    }

    console.log(
        `\n${issues.length} claimed, ${orphans.length} orphaned (no branch, no PR).`
    );
    if (orphans.length === 0) process.exit(0);
    if (!release) {
        console.log(
            "Nothing released — re-run with --release to drop `in-progress` on the orphans."
        );
        process.exit(0);
    }
    for (const n of orphans) {
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
        console.log(`${ok === 0 ? "released" : "FAILED"}  #${n}`);
    }
}
