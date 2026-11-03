/**
 * The RED ladder's revert, reconciled with the CR citation ledger (issue
 * #7965). `git revert` restores the culprit's edited citation lines together
 * with the `baseline` ledger entries the culprit had confirmed away; the base
 * branch's ledger lacks them, so `cr:lint`'s only-shrinks check reds the
 * revert PR at `land` (PR #7960). `reconcileRevertCrLedger` rewrites the
 * revert's ledger the way the manual repair did — every grown `baseline`
 * entry dropped and its line confirmed (`reconcileRevertedBaseline`, which
 * reuses `confirmLine`) — and leaves the commit to the caller.
 *
 * I/O only: the tree's tracked sources, its vendored CR, its ledger, and the
 * base's ledger out of the object store. A tree whose ledger has nothing
 * grown is not written.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    knownRuleIds,
    readSources,
    scanCitations,
} from "../check-cr-citations.ts";
import {
    baselineSites,
    LEDGER_PATH,
    parseLedger,
    reconcileRevertedBaseline,
    serializeLedger,
    type LedgerEntry,
} from "./cr-ledger.ts";
import { loadRules } from "./cr-rules.ts";

const CR_DOC = "data/cr/comprehensive-rules.txt";

/** The base commit's ledger text, or null when the base carries none. */
function ledgerAt(wt: string, base: string): string | null {
    try {
        return execFileSync("git", ["show", `${base}:${LEDGER_PATH}`], {
            cwd: wt,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            maxBuffer: 64 * 1024 * 1024,
        });
    } catch {
        return null;
    }
}

/**
 * Reconciles the ledger of the tree at `wt` (a revert, built on `base`) with
 * `base`'s: writes it when an entry was confirmed, never stages or commits.
 * Returns what was confirmed and pruned — both empty for a revert that
 * touches no citation, or a base with no ledger. Throws when a grown entry
 * cites an id the vendored CR does not resolve (the revert cannot pass
 * `cr:lint`).
 */
export function reconcileRevertCrLedger(
    wt: string,
    base: string
): { confirmed: LedgerEntry[]; pruned: LedgerEntry[] } {
    const baseText = ledgerAt(wt, base);
    if (baseText === null) return { confirmed: [], pruned: [] };
    const path = join(wt, LEDGER_PATH);
    const result = reconcileRevertedBaseline({
        ledger: parseLedger(readFileSync(path, "utf8")),
        baseBaseline: baselineSites(parseLedger(baseText)),
        citations: scanCitations(readSources(wt), knownRuleIds()).citations,
        rules: loadRules(join(wt, CR_DOC)),
    });
    if (result.confirmed.length > 0)
        writeFileSync(path, serializeLedger(result.ledger));
    return { confirmed: result.confirmed, pruned: result.pruned };
}
