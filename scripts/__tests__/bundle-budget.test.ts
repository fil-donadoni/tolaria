/**
 * Issue #9489: the `card-set-` bundle budget sums a corpus that grows with
 * every hand-written card. As a fixed byte count it turned base tip
 * `18ba7b7be854` RED on ordinary growth (490,902 B > 490,000 B), and no lane
 * runs `check:bundle` (12–24 s, health-only, issue #6989), so nothing stopped
 * it at landing. These assertions pin the policy that closes the class:
 *
 *  - ordinary growth (cards at the observed marginal) never uses up the
 *    headroom, up to the re-anchor horizon;
 *  - the accident the row exists for (literal pool re-entry) still goes red
 *    within that horizon, and the live corpus is inside it;
 *  - the count the script scales by is the corpus the chunks bundle.
 *
 * The other half of the guard is the `Budget` type in
 * `scripts/check-bundle-size.ts`: a `sum` row cannot carry a fixed byte
 * literal (`tsc` refuses it).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    OBSERVED_SET_BYTES_PER_CARD,
    POOL_REENTRY_GZIP_BYTES,
    SET_CHUNK_BUDGET,
    countHandWrittenCards,
    scaledBudgetBytes,
} from "../lib/bundle-budget";

const ROOT = join(__dirname, "..", "..");

const { anchorUnits, anchorBytes, reanchorHorizon } = SET_CHUNK_BUDGET;
/** Corpus sizes from the anchor to the re-anchor horizon. */
const ADDED = [0, 1, 100, 500, 1_000, reanchorHorizon];
/** The Set chunks' sum after `added` cards at the observed marginal. */
const grown = (added: number) =>
    anchorBytes + OBSERVED_SET_BYTES_PER_CARD * added;

describe("card-set bundle budget scales with the hand-written corpus (issue #9489)", () => {
    it("ordinary card growth stays under budget up to the re-anchor horizon", () => {
        // An allowance below the marginal spends the headroom card by card.
        expect(SET_CHUNK_BUDGET.perUnitBytes).toBeGreaterThanOrEqual(
            OBSERVED_SET_BYTES_PER_CARD
        );
        for (const added of ADDED)
            expect(grown(added)).toBeLessThanOrEqual(
                scaledBudgetBytes(SET_CHUNK_BUDGET, anchorUnits + added)
            );
    });

    it("literal-pool re-entry reds at every corpus size up to the re-anchor horizon", () => {
        for (const added of ADDED)
            expect(grown(added) + POOL_REENTRY_GZIP_BYTES).toBeGreaterThan(
                scaledBudgetBytes(SET_CHUNK_BUDGET, anchorUnits + added)
            );
    });

    it("the live corpus is within the re-anchor horizon (else: re-measure, move the anchor)", () => {
        expect(countHandWrittenCards(ROOT) - anchorUnits).toBeLessThanOrEqual(
            reanchorHorizon
        );
    });

    it("scales by the hand-written corpus the card-index lockfile indexes", () => {
        // `check:index` keeps data/card-index.json equal to the registered
        // definitions; rows without `source: "compiled"` are the hand-written
        // ones, the corpus the Set chunks bundle. The count the budget scales
        // by must be that corpus, never a stale or partial scan.
        const index = JSON.parse(
            readFileSync(join(ROOT, "data", "card-index.json"), "utf8")
        ) as { source?: string }[];
        const handWritten = index.filter((r) => r.source !== "compiled").length;
        expect(countHandWrittenCards(ROOT)).toBe(handWritten);
    });
});
