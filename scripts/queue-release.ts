#!/usr/bin/env bun
// `bun run queue:release <N>` — release issue N as ONE act (issue #4752), the
// inverse of `queue:claim`: remove `in-progress` AND the `@me` assignee, then
// append a `released` row to the claim journal. The decision and the row are
// `lib/queue-claim.ts`; this file is the I/O.
//
// `/next-issue`'s abort step names this verb, and `deny-guard.sh` § 6b denies a
// hand-typed `--remove-label in-progress` that leaves the assignee behind.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { gh } from "./lib/gh";
import { primaryCheckout } from "./lib/primary-checkout";
import { claimLedgerPath } from "./loop-doctor";
import { performRelease } from "./lib/queue-claim";

function main(): void {
    const numbers = process.argv.slice(2).filter((a) => /^#?\d+$/.test(a));
    if (numbers.length !== 1) {
        console.error("usage: bun run queue:release <issue#>");
        process.exit(2);
    }
    const issue = Number(numbers[0].replace(/^#/, ""));
    const ledger = claimLedgerPath(
        process.env.CLAUDE_PROJECT_DIR ?? primaryCheckout()
    );
    performRelease({
        issue,
        session: process.env.CLAUDE_CODE_SESSION_ID ?? "",
        now: Math.floor(Date.now() / 1000),
        gh: (args) => void gh(args),
        appendRow: (row) => {
            mkdirSync(dirname(ledger), { recursive: true });
            appendFileSync(ledger, JSON.stringify(row) + "\n");
        },
    });
    console.log(
        `queue:release: released issue #${issue} (label, assignee, journal row)`
    );
}

if (import.meta.main) {
    try {
        main();
    } catch (err) {
        console.error(`✗ queue:release: ${(err as Error).message}`);
        process.exit(1);
    }
}
