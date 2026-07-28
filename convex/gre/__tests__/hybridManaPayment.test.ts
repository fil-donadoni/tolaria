import { describe, expect, it } from "vitest";
import {
    assignHybridPips,
    hybridCostKey,
    normalizedHybridPips,
    parseHybridCostKey,
} from "../manaColors";
import { solveAutoTap } from "../autoTap";
import {
    checkManaCost,
    isManaCostCovered,
    normalizeManaCost,
    payManaCost,
} from "../state";

// Guild-hybrid mana pips (CR 202.1a / 107.4e, issue #1738). `ManaCost.hybrid`
// declares the pips (issue #1338); until this slice `normalizeManaCost` dropped
// them, so every payment consumer treated a hybrid pip as FREE.

describe("hybrid cost keys (CR 202.1a)", () => {
    it("is canonical regardless of the printed colour order", () => {
        expect(hybridCostKey("R", "W")).toBe(hybridCostKey("W", "R"));
        // The key is the PRINTED spelling — `{R/W}`, not WUBRG order — so it
        // matches the oracle text and the `R_W.svg` symbol asset.
        expect(hybridCostKey("R", "W")).toBe("R/W");
        expect(hybridCostKey("W", "G")).toBe("G/W");
    });

    it("round-trips through parseHybridCostKey", () => {
        expect(parseHybridCostKey(hybridCostKey("U", "G"))).toEqual(["G", "U"]);
    });

    it("rejects non-hybrid keys", () => {
        expect(parseHybridCostKey("W")).toBeNull();
        expect(parseHybridCostKey("X")).toBeNull();
        expect(parseHybridCostKey("W/Z")).toBeNull();
    });

    it("expands a pip count into one entry per pip", () => {
        expect(normalizedHybridPips({ "R/W": 2, W: 1, X: 3 })).toEqual([
            ["R", "W"],
            ["R", "W"],
        ]);
    });
});

describe("normalizeManaCost folds hybrid pips (CR 202.1a, issue #1738)", () => {
    it("emits a composite key per pip instead of dropping the array", () => {
        const cost = normalizeManaCost({
            generic: 1,
            hybrid: [
                ["R", "W"],
                ["R", "W"],
            ],
        });
        expect(cost).toEqual({ X: 1, "R/W": 2 });
    });

    it("keeps the colour and generic slots untouched", () => {
        const cost = normalizeManaCost({
            X: "X",
            B: 1,
            hybrid: [["G", "U"]],
        });
        expect(cost.B).toBe(1);
        expect(cost["G/U"]).toBe(1);
    });
});

describe("hybrid pip assignment (CR 202.1a)", () => {
    it("pays a pip from either of its colours", () => {
        expect(assignHybridPips({ R: 1 }, [["R", "W"]])).toEqual({ R: 1 });
        expect(assignHybridPips({ W: 1 }, [["R", "W"]])).toEqual({ W: 1 });
    });

    it("returns null when neither colour is available", () => {
        expect(assignHybridPips({ G: 5 }, [["R", "W"]])).toBeNull();
    });

    it("rehouses an earlier pip rather than stranding a later one", () => {
        // A per-pip greedy that pays {R/W} with W leaves nothing for {W/U};
        // the matching must reassign the first pip to R.
        const spent = assignHybridPips({ R: 1, W: 1 }, [
            ["R", "W"],
            ["W", "U"],
        ]);
        expect(spent).toEqual({ R: 1, W: 1 });
    });

    it("honours mana substitutions (CR 609.4b)", () => {
        // Every Forest taps for black: a G pool pays a {B/G}-adjacent pip via
        // the substituted colour.
        expect(
            assignHybridPips({ G: 1 }, [["B", "U"]], [{ from: "G", to: "B" }])
        ).toEqual({ G: 1 });
    });
});

describe("coverage owes hybrid pips (CR 202.1a / 601.2g)", () => {
    const cost = normalizeManaCost({
        generic: 1,
        hybrid: [
            ["R", "W"],
            ["R", "W"],
        ],
    });

    it("is NOT covered by an empty pool — a hybrid pip is never free", () => {
        expect(isManaCostCovered({}, cost)).toBe(false);
        // The regression this slice closes: before the fix, three mana of any
        // colour "covered" {1}{R/W}{R/W} because the pips were dropped.
        expect(isManaCostCovered({ G: 1 }, cost)).toBe(false);
        expect(isManaCostCovered({ G: 3 }, cost)).toBe(false);
    });

    it("is covered when both pips and the generic are payable", () => {
        expect(isManaCostCovered({ R: 2, G: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ R: 1, W: 1, G: 1 }, cost)).toBe(true);
        expect(isManaCostCovered({ W: 3 }, cost)).toBe(true);
    });

    it("rejects a pool that can pay the pips but not the generic tail", () => {
        expect(isManaCostCovered({ R: 2 }, cost)).toBe(false);
    });

    it("checkManaCost agrees with isManaCostCovered", () => {
        expect(checkManaCost({ R: 2, G: 1 }, cost)).toBeNull();
        expect(checkManaCost({ G: 3 }, cost)).not.toBeNull();
    });

    it("names the hybrid pips in the shortfall message", () => {
        expect(checkManaCost({}, cost)).toContain("{R/W}");
    });
});

describe("payment deducts hybrid pips (CR 601.2g)", () => {
    it("spends one mana per pip, generic last", () => {
        const pool: Record<string, number> = { R: 2, G: 1 };
        payManaCost(
            pool,
            normalizeManaCost({
                generic: 1,
                hybrid: [
                    ["R", "W"],
                    ["R", "W"],
                ],
            })
        );
        expect(pool.R).toBe(0);
        expect(pool.G).toBe(0);
    });

    it("leaves the colour requirement's mana alone", () => {
        const pool: Record<string, number> = { W: 1, R: 1 };
        payManaCost(pool, normalizeManaCost({ W: 1, hybrid: [["R", "W"]] }));
        expect(pool.W).toBe(0);
        expect(pool.R).toBe(0);
    });

    it("honours the explicit generic spend order after the pips", () => {
        const pool: Record<string, number> = { R: 1, U: 2 };
        payManaCost(
            pool,
            normalizeManaCost({ generic: 1, hybrid: [["R", "W"]] }),
            [],
            ["U"]
        );
        expect(pool.R).toBe(0);
        expect(pool.U).toBe(1);
    });
});

describe("auto-tap pays hybrid pips (CR 601.2g, issue #1739)", () => {
    const cost = normalizeManaCost({ hybrid: [["R", "W"]] });
    const mountain = { cardId: "mountain", options: [{ mana: { R: 1 } }] };
    const plains = { cardId: "plains", options: [{ mana: { W: 1 } }] };
    const forest = { cardId: "forest", options: [{ mana: { G: 1 } }] };

    it("taps either colour for a {R/W} pip", () => {
        expect(solveAutoTap({}, cost, [], [mountain])).toEqual([
            { cardId: "mountain" },
        ]);
        expect(solveAutoTap({}, cost, [], [plains])).toEqual([
            { cardId: "plains" },
        ]);
    });

    it("returns null when no source can pay the pip", () => {
        expect(solveAutoTap({}, cost, [], [forest])).toBeNull();
    });

    it("never over-taps — one source for one pip", () => {
        const plan = solveAutoTap({}, cost, [], [forest, mountain, plains]);
        expect(plan).toHaveLength(1);
    });

    it("taps nothing when the pool already covers the pip", () => {
        expect(solveAutoTap({ W: 1 }, cost, [], [mountain])).toEqual([]);
    });
});
