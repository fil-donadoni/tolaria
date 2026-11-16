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
    OBSERVED_SET_BYTES_PER_RETIRED_CARD,
    POOL_REENTRY_GZIP_BYTES,
    SET_CHUNK_BUDGET,
    countHandWrittenCards,
    meanUnitBytes,
    scaledBudgetBytes,
    withinReanchorHorizons,
} from "../lib/bundle-budget";

const ROOT = join(__dirname, "..", "..");

const { anchorUnits, anchorBytes, reanchorHorizon, reanchorHorizonBelow } =
    SET_CHUNK_BUDGET;
/** Corpus sizes from the anchor to the re-anchor horizon. */
const ADDED = [0, 1, 100, 500, 1_000, reanchorHorizon];
/** The Set chunks' sum after `added` cards at the observed marginal. */
const grown = (added: number) =>
    anchorBytes + OBSERVED_SET_BYTES_PER_CARD * added;
/** Corpus sizes from the anchor down to the lower re-anchor horizon. */
const REMOVED = [1, 40, 100, 259, reanchorHorizonBelow];
/** The Set chunks' sum after `removed` cards, each shedding `shed` bytes. */
const shrunk = (removed: number, shed: number) => anchorBytes - shed * removed;

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

    it("the live corpus is within both re-anchor horizons (else: re-measure with `bun run check:bundle`, move the anchor in scripts/lib/bundle-budget.ts)", () => {
        expect(
            withinReanchorHorizons(
                SET_CHUNK_BUDGET,
                countHandWrittenCards(ROOT)
            )
        ).toBe(true);
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

/**
 * The corpus also SHRINKS (issue #10048). The Oracle migrations retired 259
 * hand-written cards, the budget gave back the growth allowance for each
 * (340 B against ~136 B shed), and base tip `7700f6300f9d` went RED with
 * nothing back in the graph. These assertions pin the shrink leg the way the
 * block above pins growth, and the horizon assertion is two-sided.
 * `check:lane` runs this file on every diff that moves the corpus (the
 * `bundle-budget` cheap guard): the landing that leaves the horizons is
 * refused, not the base tip.
 */
describe("card-set bundle budget follows a shrinking corpus at the shed rate (issue #10048)", () => {
    it("ordinary retirement stays under budget down to the lower re-anchor horizon", () => {
        // A shrink rate above the shed spends the headroom card by card: the
        // budget falls faster than the chunks do.
        expect(SET_CHUNK_BUDGET.perUnitShrinkBytes).toBeLessThanOrEqual(
            OBSERVED_SET_BYTES_PER_RETIRED_CARD
        );
        for (const removed of REMOVED)
            expect(
                shrunk(removed, OBSERVED_SET_BYTES_PER_RETIRED_CARD)
            ).toBeLessThanOrEqual(
                scaledBudgetBytes(SET_CHUNK_BUDGET, anchorUnits - removed)
            );
    });

    it("the measured RED stretch stays under a budget anchored where it began", () => {
        // Issue #9489's anchor to tip 7700f6300f9d: 2,266 cards / 490,902 B
        // down to 2,024 cards / 458,040 B, both measured by check:bundle.
        const before = {
            ...SET_CHUNK_BUDGET,
            anchorUnits: 2_266,
            anchorBytes: 490_902,
        };
        expect(458_040).toBeLessThanOrEqual(scaledBudgetBytes(before, 2_024));
    });

    it("literal-pool re-entry reds at every corpus size down to the lower re-anchor horizon", () => {
        // The loosest case: each retired card sheds as much as the mean card.
        const shed = meanUnitBytes(SET_CHUNK_BUDGET);
        expect(shed).toBeGreaterThan(OBSERVED_SET_BYTES_PER_RETIRED_CARD);
        for (const removed of REMOVED)
            expect(
                shrunk(removed, shed) + POOL_REENTRY_GZIP_BYTES
            ).toBeGreaterThan(
                scaledBudgetBytes(SET_CHUNK_BUDGET, anchorUnits - removed)
            );
    });

    it("a corpus outside either horizon asks for a re-anchor", () => {
        const within = (units: number) =>
            withinReanchorHorizons(SET_CHUNK_BUDGET, units);
        expect(within(anchorUnits)).toBe(true);
        expect(within(anchorUnits + reanchorHorizon)).toBe(true);
        expect(within(anchorUnits + reanchorHorizon + 1)).toBe(false);
        expect(within(anchorUnits - reanchorHorizonBelow)).toBe(true);
        expect(within(anchorUnits - reanchorHorizonBelow - 1)).toBe(false);
    });
});
