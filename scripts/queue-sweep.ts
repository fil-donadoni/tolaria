// Release orphaned `in-progress` claims — the loop's claim lock, unstuck.
//
// ── Why this is its own entry point ──────────────────────────────────────────
//
// The sweep used to exist ONLY inside `scripts/queue-plan.ts`, as a by-product
// of building a batch: the planner walked every `ready-for-agent` issue, and an
// `in-progress` one that was stale came back under `staleClaims` for the
// orchestrator to release. That coupling has two holes, and both were measured
// on 2026-08-20:
//
//  1. **A pass that does not run the planner never sweeps.** An armed AFK conf
//     can carry a SCOPE OVERRIDE prompt telling the pass to skip the planner
//     and assemble the batch by hand (e.g. "work only on sub-issues of PRD
//     #2405"). Every such pass releases nothing. Eight claims — four of them
//     P0 — had sat orphaned for 25-36 hours while a driver ran continuously
//     past them, because the driver's own prompt had opted out of the only
//     code path that could free them.
//
//  2. **The planner only ever sees `ready-for-agent` issues.** A claim whose
//     `ready-for-agent` label was stripped after it was taken is invisible to
//     the planner's query, so it can never be swept there at any cadence. This
//     script queries by `in-progress` instead, which is exactly the set of
//     claims that exist.
//
// A stuck claim is worse than a lost one: the issue reads as taken, so no pass
// reselects it, and nothing in the loop ever revisits the decision. It removes
// itself from the queue permanently and silently.
//
// The rule itself lives in `isStaleClaim` (`scripts/lib/queue-plan.ts`) and is
// shared with the planner, so the two can never drift into disagreeing about
// what "dead" means.
//
// ── Usage ────────────────────────────────────────────────────────────────────
//
//   bun run queue:sweep              # report only — prints the JSON, writes nothing
//   bun run queue:sweep --release    # remove `in-progress` + assignee on each
//   bun run queue:sweep --stale-hours 48
//
// Reporting is the default deliberately: the destructive direction should be
// the one you type on purpose.

import { gh } from "./lib/gh";
import { isStaleClaim, type QueueIssue } from "./lib/queue-plan";

const DEFAULTS = {
    // Same value as the planner's, and the same reasoning: a claim younger
    // than this may simply belong to a long-running pass.
    staleClaimHours: 24,
    // The claim set is small by construction (it is bounded by how many passes
    // can run at once), so this is slack, not a window that could truncate the
    // way `gh issue list`'s default 30 silently did elsewhere.
    limit: 200,
};

interface SweptClaim {
    number: number;
    title: string;
    updatedAt: string;
    hoursIdle: number;
    /** Logins to un-assign — see the release call for why this is load-bearing. */
    assignees: string[];
    released: boolean;
}

function numberArg(name: string, fallback: number): number {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = Number(process.argv[i + 1]);
    if (!Number.isFinite(value)) {
        console.error(`✗ --${name} needs a number`);
        process.exit(2);
    }
    return value;
}

/** Issues with an open PR — the liveness signal that keeps a long-running claim
 *  from being swept. Derived from the head branch name, because that branch is
 *  the loop's atomic ownership claim (`feat/issue-N` / `fix/issue-N`). */
export function issuesWithOpenPr(run: typeof gh = gh): number[] {
    const prs = JSON.parse(
        run([
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "headRefName",
            "--limit",
            "100",
        ])
    ) as { headRefName: string }[];
    return prs
        .map((pr) => /^(?:feat|fix)\/issue-(\d+)$/.exec(pr.headRefName)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number);
}

/**
 * The pure half: which of these claims are dead, and how long each has sat.
 *
 * Split out from `main` so the decision is testable without a network, and so
 * the reporting and releasing paths cannot disagree about the answer — one
 * computes it, the other acts on the same array.
 */
export function selectStaleClaims(
    claims: QueueIssue[],
    ctx: { issuesWithOpenPr: number[]; now: string; staleClaimHours: number }
): Omit<SweptClaim, "released">[] {
    return claims
        .filter((issue) => isStaleClaim(issue, ctx))
        .map((issue) => ({
            number: issue.number,
            title: issue.title,
            updatedAt: issue.updatedAt,
            assignees: issue.assignees.map((a) => a.login),
            hoursIdle: Math.floor(
                (Date.parse(ctx.now) - Date.parse(issue.updatedAt)) / 3_600_000
            ),
        }));
}

function main(): void {
    const staleClaimHours = numberArg("stale-hours", DEFAULTS.staleClaimHours);
    const release = process.argv.includes("--release");

    const claims = JSON.parse(
        gh([
            "issue",
            "list",
            "--label",
            "in-progress",
            "--state",
            "open",
            "--json",
            "number,title,labels,parent,assignees,updatedAt",
            "--limit",
            String(DEFAULTS.limit),
        ])
    ) as QueueIssue[];

    const stale = selectStaleClaims(claims, {
        issuesWithOpenPr: issuesWithOpenPr(),
        now: new Date().toISOString(),
        staleClaimHours,
    });

    const swept: SweptClaim[] = stale.map((claim) => {
        if (!release) return { ...claim, released: false };
        // Best-effort per claim: one issue failing to release (a permissions
        // blip, a label removed by hand between the list and the edit) must
        // not abort the rest of the sweep — the whole point is that nothing
        // stays stuck because one thing went wrong.
        try {
            // The assignee comes off TOO, and that is not cosmetic: the
            // planner defers an assigned issue on its own branch
            // ("assigned — someone is working it"), so dropping only the label
            // would leave the issue exactly as unreselectable as before, while
            // reporting it as released. Remove the logins the issue actually
            // carries rather than `@me` — a sweep may run from a different
            // session than the one that crashed.
            gh([
                "issue",
                "edit",
                String(claim.number),
                "--remove-label",
                "in-progress",
                ...claim.assignees.flatMap((login) => [
                    "--remove-assignee",
                    login,
                ]),
            ]);
            return { ...claim, released: true };
        } catch (err) {
            console.error(
                `✗ #${claim.number}: ${(err as Error).message.trim()}`
            );
            return { ...claim, released: false };
        }
    });

    process.stdout.write(
        JSON.stringify(
            {
                version: 1,
                checked: claims.length,
                staleClaimHours,
                released: release,
                claims: swept,
            },
            null,
            process.argv.includes("--pretty") ? 2 : 0
        ) + "\n"
    );
}

if (import.meta.main) {
    main();
}
