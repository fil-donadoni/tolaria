#!/usr/bin/env bun
/**
 * `bun run oracle:prune-regressions` — delete the state-regression
 * acknowledgements that match no regression any more (issue #6061).
 *
 * An entry in `data/oracle-state-regressions.json` lets ONE card leave the
 * `ready` pool in ONE change. Once that change lands the card is part of the
 * baseline, the entry matches nothing, and `check:oracle` only prints a dim
 * "safe to delete" line — so it stayed in the file for good. The lane cannot
 * red a PR on a stale entry (after every landing it would red unrelated PRs),
 * and a PR author should not have to remember the cleanup, so this runs after
 * the merge: `housekeeping` calls it beside `gaps:sync`, from the merged tree.
 *
 * Regressions are measured exactly as `check:oracle` measures them (lockfile
 * at the merge-base vs the tree). On the base tip that is the empty set, so
 * every entry is stale — each one was written for a change that has landed.
 * The write is a direct commit on the base branch (`commitAndPushAllowlist`,
 * the path `gaps:sync` uses), never the working tree; `--dry-run` prints the
 * plan and writes nothing.
 *
 * Exit 0 when pruned or nothing to prune, 1 when the commit did not reach the
 * remote (housekeeping retries; the prune is idempotent).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { baselineOutcome } from "./check-oracle-lockfile";
import { commitAndPushAllowlist } from "./gaps-sync";
import { gitRunner } from "./lib/base-artifact";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    parseRegressionLedger,
    pruneStaleAcknowledgements,
    readyRegressions,
    renderRegressionLedger,
    REGRESSION_LEDGER_PATH,
    type ReadyRegression,
} from "./lib/oracle-state-regressions";

/** Subject of the one commit this step pushes to the base branch — `land`
 *  tells it from a foreign push by it and by its file (`VERIFY_MERGED_TIP`),
 *  and `land.test.ts` pins the two spellings equal. */
export const PRUNE_COMMIT_SUBJECT =
    "oracle:prune-regressions — drop acknowledgements that match no regression";

/** The ledger text after pruning; the input text itself when nothing is stale,
 *  so "unchanged" is a string comparison. The ledger's `note` survives. */
export function prunedLedgerText(
    text: string,
    regressions: readonly ReadyRegression[]
): string {
    const ledger = parseRegressionLedger(text);
    const pruned = pruneStaleAcknowledgements(regressions, ledger);
    if (pruned.acknowledged.length === ledger.acknowledged.length) return text;
    return renderRegressionLedger(pruned);
}

function main(argv: readonly string[]): number {
    const root = join(dirname(new URL(import.meta.url).pathname), "..");
    const baseline = baselineOutcome(gitRunner(root));
    if (baseline.kind !== "lockfile") {
        const why = baseline.kind === "broken" ? baseline.detail : baseline.why;
        console.log(`oracle:prune-regressions: skipped — ${why}`);
        return baseline.kind === "broken" ? 1 : 0;
    }
    const lock = parseLockfile(
        readFileSync(join(root, "data", "oracle-compiled.json"), "utf8")
    );
    const regressions = readyRegressions(baseline.lock.cards, lock.cards);
    const current = readFileSync(join(root, REGRESSION_LEDGER_PATH), "utf8");
    const next = prunedLedgerText(current, regressions);
    if (next === current) {
        console.log("oracle:prune-regressions: nothing stale");
        return 0;
    }
    const before = parseRegressionLedger(current).acknowledged;
    const after = new Set(
        parseRegressionLedger(next).acknowledged.map((a) => a.oracleId)
    );
    const dropped = before.filter((a) => !after.has(a.oracleId));
    console.log(
        `oracle:prune-regressions: ${dropped.length} stale acknowledgement(s): ${dropped.map((a) => a.name).join(", ")}`
    );
    if (argv.includes("--dry-run")) return 0;
    return commitAndPushAllowlist(
        root,
        (text) => prunedLedgerText(text, regressions),
        undefined,
        { path: REGRESSION_LEDGER_PATH, subject: PRUNE_COMMIT_SUBJECT }
    )
        ? 0
        : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
