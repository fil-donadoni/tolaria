#!/usr/bin/env bun
/**
 * `bun run land:ready <PR#>` — a session's LAST act (issue #5469): hand the
 * pushed PR to the land-runner. One verb, so the two halves never split:
 *
 *   1. the PR is labelled `ready-to-land` (and loses `land-failed`, so a
 *      repaired PR re-queues with the same command);
 *   2. the claim journal gets the issue's `pr-open` row: the claim stands,
 *      but it holds no `sessions.cap` slot on this machine any more;
 *   3. the issue gets the `pr-open` label beside `in-progress`, so the board
 *      shows the hand-off (issue #5562; every release path removes it).
 *
 * Refuses a PR that is not open or does not target the base branch — the
 * runner's `land` would refuse it anyway, an hour later, as a `land-failed`.
 * The decisions are `lib/land-runner.ts` and `lib/queue-claim.ts`; this file
 * is the I/O.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { dirname } from "node:path";
import { BASE_BRANCH } from "./lib/branches";
import { prOpenEditArgs, PR_OPEN_LABEL } from "./lib/claim-labels";
import { gh } from "./lib/gh";
import { issueOfBranch } from "./lib/issue-worktree";
import { labelArgs, READY_LABEL } from "./lib/land-runner";
import { primaryCheckout } from "./lib/primary-checkout";
import { buildPrOpenRow } from "./lib/queue-claim";
import { claimLedgerPath } from "./loop-doctor";

function main(): void {
    const numbers = process.argv.slice(2).filter((a) => /^#?\d+$/.test(a));
    if (numbers.length !== 1) {
        console.error("usage: bun run land:ready <PR#>");
        process.exit(2);
    }
    const pr = Number(numbers[0].replace(/^#/, ""));
    const view = JSON.parse(
        gh([
            "pr",
            "view",
            String(pr),
            "--json",
            "state,headRefName,baseRefName",
        ])
    ) as { state: string; headRefName: string; baseRefName: string };
    if (view.state !== "OPEN") {
        console.error(`✗ land:ready: PR #${pr} is ${view.state}, not OPEN`);
        process.exit(1);
    }
    if (view.baseRefName !== BASE_BRANCH) {
        console.error(
            `✗ land:ready: PR #${pr} targets \`${view.baseRefName}\`, not \`${BASE_BRANCH}\` — \`gh pr edit ${pr} --base ${BASE_BRANCH}\`, then re-run`
        );
        process.exit(1);
    }
    gh(labelArgs.ready(pr));

    const issue = issueOfBranch(view.headRefName);
    if (issue !== null) {
        gh(prOpenEditArgs(issue));
        const ledger = claimLedgerPath(
            process.env.CLAUDE_PROJECT_DIR ?? primaryCheckout()
        );
        mkdirSync(dirname(ledger), { recursive: true });
        appendFileSync(
            ledger,
            JSON.stringify(
                buildPrOpenRow({
                    now: Math.floor(Date.now() / 1000),
                    session: process.env.CLAUDE_CODE_SESSION_ID ?? "",
                    issue,
                    pr,
                    host: hostname(),
                })
            ) + "\n"
        );
    }
    console.log(
        `land:ready: PR #${pr} labelled \`${READY_LABEL}\` — the land-runner lands it` +
            (issue === null
                ? ""
                : `; issue #${issue} labelled \`${PR_OPEN_LABEL}\`, its claim is now pr-open`)
    );
}

if (import.meta.main) {
    try {
        main();
    } catch (err) {
        console.error(`✗ land:ready: ${(err as Error).message}`);
        process.exit(1);
    }
}
