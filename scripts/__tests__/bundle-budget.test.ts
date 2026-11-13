/**
 * Issue #9489: the `card-set-` bundle budget sums a corpus that grows with
 * every hand-written card. As a fixed byte count it turned base tip
 * `18ba7b7be854` RED on ordinary growth (490,902 B > 490,000 B), and no lane
 * runs `check:bundle` (12–24 s, health-only, issue #6989), so nothing stopped
 * it at landing. These assertions pin the policy that closes the class:
 *
 *  - ordinary growth (cards at the observed marginal) never uses up the
 *    headroom, however many land;
 *  - the accident the row exists for (literal pool re-entry) still goes red;
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

describe("card-set bundle budget scales with the hand-written corpus (issue #9489)", () => {
    it("allows at least the observed per-card marginal, so card growth never uses up the headroom", () => {
        expect(SET_CHUNK_BUDGET.perUnitBytes).toBeGreaterThanOrEqual(
            OBSERVED_SET_BYTES_PER_CARD
        );
        // 5,000 more cards at the observed marginal: still under budget.
        const { anchorUnits, anchorBytes } = SET_CHUNK_BUDGET;
        for (const added of [0, 1, 100, 1_000, 5_000]) {
            const measured = anchorBytes + OBSERVED_SET_BYTES_PER_CARD * added;
            expect(measured).toBeLessThanOrEqual(
                scaledBudgetBytes(SET_CHUNK_BUDGET, anchorUnits + added)
            );
        }
    });

    it("still reds on literal-pool re-entry at any corpus size", () => {
        expect(SET_CHUNK_BUDGET.headroomBytes).toBeLessThan(
            POOL_REENTRY_GZIP_BYTES
        );
        const { anchorUnits, anchorBytes } = SET_CHUNK_BUDGET;
        expect(anchorBytes + POOL_REENTRY_GZIP_BYTES).toBeGreaterThan(
            scaledBudgetBytes(SET_CHUNK_BUDGET, anchorUnits)
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
