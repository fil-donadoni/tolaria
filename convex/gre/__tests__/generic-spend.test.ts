import { describe, it, expect } from "vitest";
import {
    genericSpendAmbiguity,
    genericSpendAmbiguityForPayment,
    payManaCost,
} from "../state";

// ---------------------------------------------------------------------------
// Generic-mana spend — core primitives (CR 601.2g: the player chooses which
// mana in their pool to spend for a generic cost). Issue #1443, parent #1442.
//
// `genericSpendAmbiguity` is evaluated AFTER colored/colorless requirements are
// settled, so `pool` and the outstanding `generic` reflect only the generic
// portion. `payManaCost` gains an optional trailing `genericSpendOrder`; when
// omitted its behavior is byte-identical to the historical greedy default.
// ---------------------------------------------------------------------------

const emptyPool = () => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });

describe("genericSpendAmbiguity (CR 601.2g)", () => {
    it("returns null when nothing generic is owed", () => {
        expect(genericSpendAmbiguity({ ...emptyPool(), U: 1, G: 1 }, 0)).toBe(
            null
        );
    });

    it("returns null for a single-color pool (no choice to make)", () => {
        // {U:1} pay {1} → only one source → auto-pick.
        expect(genericSpendAmbiguity({ ...emptyPool(), U: 1 }, 1)).toBe(null);
    });

    it("returns null when both colors survive either choice (leftover set identical)", () => {
        // {U:2,G:2} pay {1} → spending 1 from either leaves {U,G} either way.
        expect(genericSpendAmbiguity({ ...emptyPool(), U: 2, G: 2 }, 1)).toBe(
            null
        );
    });

    it("returns candidate colors for the genuinely ambiguous case", () => {
        // {U:1,G:1} pay {1} → spend U leaves {G}, spend G leaves {U}: different
        // leftover sets → the choice is meaningful.
        const result = genericSpendAmbiguity({ ...emptyPool(), U: 1, G: 1 }, 1);
        expect(result).not.toBe(null);
        expect(result!.generic).toBe(1);
        // Canonical W,U,B,R,G,C order.
        expect(result!.candidateColors).toEqual(["U", "G"]);
    });

    it("returns null when the entire pool is consumed (single empty leftover)", () => {
        // {U:1,G:1} pay {2} → everything spent, only one outcome.
        expect(genericSpendAmbiguity({ ...emptyPool(), U: 1, G: 1 }, 2)).toBe(
            null
        );
    });

    it("flags ambiguity when draining one color vs. not changes the leftover set", () => {
        // {U:1,G:3} pay {2}: spend 2 from G → leftover {U,G}; spend U+G →
        // leftover {G}. Different leftover sets → ambiguous.
        const result = genericSpendAmbiguity({ ...emptyPool(), U: 1, G: 3 }, 2);
        expect(result).not.toBe(null);
        expect(result!.candidateColors).toEqual(["U", "G"]);
    });

    it("returns null when every spend leaves all colors present", () => {
        // {U:3,G:3} pay {2}: no way to drain a color, leftover is always {U,G}.
        expect(genericSpendAmbiguity({ ...emptyPool(), U: 3, G: 3 }, 2)).toBe(
            null
        );
    });

    it("lists every present color as a candidate (3-color pool)", () => {
        // {U:1,G:1,R:5} pay {1}: spend from U/G/R → {G,R}/{U,R}/{U,G} — all
        // distinct, and any present color is a legal source.
        const result = genericSpendAmbiguity(
            { ...emptyPool(), U: 1, R: 5, G: 1 },
            1
        );
        expect(result).not.toBe(null);
        expect(result!.candidateColors).toEqual(["U", "R", "G"]);
    });
});

describe("payManaCost generic spend-order (CR 601.2g)", () => {
    it("omitted genericSpendOrder is identical to the greedy default", () => {
        const withDefault = { ...emptyPool(), W: 3, U: 1 };
        const withUndefined = { ...emptyPool(), W: 3, U: 1 };
        // {2} generic — greedy takes from the largest pool (W).
        payManaCost(withDefault, { X: 2 });
        payManaCost(withUndefined, { X: 2 }, []);
        expect(withDefault).toEqual({ ...emptyPool(), W: 1, U: 1 });
        expect(withUndefined).toEqual({ ...emptyPool(), W: 1, U: 1 });
    });

    it("supplied order spends exactly that order for the generic phase", () => {
        const pool = { ...emptyPool(), W: 3, U: 1 };
        // Greedy would drain W; explicit order [U, W] spends U first instead.
        payManaCost(pool, { X: 2 }, [], ["U", "G", "W"]);
        expect(pool.U).toBe(0); // U drained first
        expect(pool.W).toBe(2); // then 1 more from W
    });

    it("honors a full ambiguous choice — draining the chosen color", () => {
        // {U:1,G:1} pay {1}: order [U] drains U, leaving {G}.
        const pool = { ...emptyPool(), U: 1, G: 1 };
        payManaCost(pool, { X: 1 }, [], ["U", "G"]);
        expect(pool.U).toBe(0);
        expect(pool.G).toBe(1);
    });

    it("falls back to greedy for residual not covered by the order", () => {
        // Order lists only U (1 available); the remaining 1 generic falls back
        // to greedy over the rest (W, largest).
        const pool = { ...emptyPool(), W: 3, U: 1 };
        payManaCost(pool, { X: 2 }, [], ["U"]);
        expect(pool.U).toBe(0);
        expect(pool.W).toBe(2);
    });

    it("still pays colored requirements before the generic phase", () => {
        // {1}{W}: W pays the colored pip, then generic order applies.
        const pool = { ...emptyPool(), W: 1, U: 2 };
        payManaCost(pool, { X: 1, W: 1 }, [], ["U"]);
        expect(pool.W).toBe(0); // colored W consumed
        expect(pool.U).toBe(1); // 1 generic from U
    });
});

describe("genericSpendAmbiguityForPayment (CR 601.2g — finalize-point bridge)", () => {
    it("returns null when there is no generic cost", () => {
        // {U}: colored only — no generic choice.
        expect(
            genericSpendAmbiguityForPayment(
                { ...emptyPool(), U: 1, G: 1 },
                {
                    U: 1,
                }
            )
        ).toBe(null);
    });

    it("flags the ambiguous case AFTER colored pips are settled", () => {
        // {1}{W} with pool {W:1,U:1,G:1}: the W pip settles first, leaving
        // {U:1,G:1} to pay the {1} generic → spend U leaves {G}, spend G leaves
        // {U}: meaningful choice.
        const result = genericSpendAmbiguityForPayment(
            { ...emptyPool(), W: 1, U: 1, G: 1 },
            { X: 1, W: 1 }
        );
        expect(result).not.toBe(null);
        expect(result!.generic).toBe(1);
        expect(result!.candidateColors).toEqual(["U", "G"]);
    });

    it("returns null when the colored phase drains a would-be candidate", () => {
        // {1}{U} with pool {U:1,G:1}: the U pip eats the only U, leaving {G:1}
        // for the {1} generic → a single source, no choice.
        expect(
            genericSpendAmbiguityForPayment(
                { ...emptyPool(), U: 1, G: 1 },
                {
                    X: 1,
                    U: 1,
                }
            )
        ).toBe(null);
    });

    it("does not mutate the pool it inspects (simulation only)", () => {
        const pool = { ...emptyPool(), U: 1, G: 1 };
        genericSpendAmbiguityForPayment(pool, { X: 1 });
        expect(pool).toEqual({ ...emptyPool(), U: 1, G: 1 });
    });

    it("returns null for the trivial single-color pool", () => {
        // {1} with only U in pool → auto-pick, no park.
        expect(
            genericSpendAmbiguityForPayment({ ...emptyPool(), U: 2 }, { X: 1 })
        ).toBe(null);
    });
});
