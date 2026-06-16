import { describe, it, expect } from "vitest";
import {
    buildAutoTapSources,
    solveAutoTap,
    type AutoTapSource,
} from "../autoTap";
import { makeInstance } from "../../cards/__tests__/setup";

// Card ids (LEA set).
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // {T}: G
const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5"; // {T}: U
const TUNDRA = "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb"; // {T}: W or U
const BIRDS = "55fe6449-1f23-43dc-adee-d144cd505b5c"; // creature, any color
const MOX_EMERALD = "b0e1427c-05cd-465b-be59-97ed6e39f7ba"; // {T}: G
const SOL_RING = "c4300d24-1cae-4dd5-be7e-38cc677cf5bd"; // {T}: C C
const BLACK_LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // sacrifice
const LLANOWAR = "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb"; // creature, G

const EMPTY_POOL = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };

/** Fixed single-color source helper for solver-only tests. */
function fixed(cardId: string, color: string, amount = 1): AutoTapSource {
    return { cardId, options: [{ mana: { [color]: amount } as never }] };
}

/** Choice source helper (one option per color). */
function choice(cardId: string, colors: string[]): AutoTapSource {
    return {
        cardId,
        options: colors.map((c, i) => ({
            manaChoiceIndex: i,
            mana: { [c]: 1 } as never,
        })),
    };
}

describe("solveAutoTap — minimal valid combination (CR 601.2g)", () => {
    it("returns [] when the pool already covers the cost", () => {
        const plan = solveAutoTap(
            { ...EMPTY_POOL, R: 1 },
            { R: 1 },
            [],
            [fixed("l1", "R")]
        );
        expect(plan).toEqual([]);
    });

    it("taps a single source for a one-pip cost", () => {
        const plan = solveAutoTap(
            EMPTY_POOL,
            { G: 1 },
            [],
            [fixed("forest", "G")]
        );
        expect(plan).toEqual([{ cardId: "forest" }]);
    });

    it("never over-taps: picks fewest sources for generic cost", () => {
        const plan = solveAutoTap(
            EMPTY_POOL,
            { X: 2 },
            [],
            [fixed("l1", "R"), fixed("l2", "R"), fixed("l3", "R")]
        );
        expect(plan).toHaveLength(2);
    });

    it("combines floating mana with a single tap", () => {
        const plan = solveAutoTap(
            { ...EMPTY_POOL, R: 1 },
            { R: 1, X: 1 },
            [],
            [fixed("l1", "R"), fixed("l2", "R")]
        );
        // R covered by floating, generic needs one tap.
        expect(plan).toHaveLength(1);
    });

    it("respects colored + generic together", () => {
        // Cost {U}{1}: must produce a U and one more of anything.
        const plan = solveAutoTap(
            EMPTY_POOL,
            { U: 1, X: 1 },
            [],
            [fixed("forest", "G"), fixed("island", "U")]
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
        const ids = plan!.map((p) => p.cardId).sort();
        expect(ids).toEqual(["forest", "island"]);
    });

    it("picks the right color from a choice source", () => {
        const plan = solveAutoTap(
            EMPTY_POOL,
            { U: 1 },
            [],
            [choice("tundra", ["W", "U"])]
        );
        expect(plan).toEqual([{ cardId: "tundra", manaChoiceIndex: 1 }]);
    });

    it("prefers a restricted source over a flexible one", () => {
        // Need G: an island (U only) can't help; a Birds (any) could, but a
        // Forest (G) is restricted and listed first → chosen.
        const plan = solveAutoTap(
            EMPTY_POOL,
            { G: 1 },
            [],
            [fixed("forest", "G"), choice("birds", ["W", "U", "B", "R", "G"])]
        );
        expect(plan).toEqual([{ cardId: "forest" }]);
    });

    it("falls back to a flexible source when no restricted one fits", () => {
        const plan = solveAutoTap(
            EMPTY_POOL,
            { G: 1 },
            [],
            [fixed("island", "U"), choice("birds", ["W", "U", "B", "R", "G"])]
        );
        expect(plan).toEqual([{ cardId: "birds", manaChoiceIndex: 4 }]);
    });

    it("returns null when no combination can pay", () => {
        const plan = solveAutoTap(
            EMPTY_POOL,
            { U: 2 },
            [],
            [fixed("forest", "G"), fixed("island", "U")]
        );
        expect(plan).toBeNull();
    });

    it("honors mana substitutions (CR 609.4b)", () => {
        // Spend G as though it were U.
        const plan = solveAutoTap(
            EMPTY_POOL,
            { U: 1 },
            [{ from: "G", to: "U" }],
            [fixed("forest", "G")]
        );
        expect(plan).toEqual([{ cardId: "forest" }]);
    });

    it("uses a 2-mana source to cover a 2-generic cost in one tap", () => {
        const plan = solveAutoTap(
            EMPTY_POOL,
            { X: 2 },
            [],
            [fixed("sol", "C", 2), fixed("l2", "R")]
        );
        expect(plan).toEqual([{ cardId: "sol" }]);
    });
});

describe("buildAutoTapSources — source selection", () => {
    it("includes basic lands and fixed Moxen", () => {
        const sources = buildAutoTapSources([
            makeInstance(FOREST, { id: "f1" }),
            makeInstance(MOX_EMERALD, { id: "m1" }),
        ]);
        const ids = sources.map((s) => s.cardId).sort();
        expect(ids).toEqual(["f1", "m1"]);
        // Each is a single fixed option.
        expect(sources.every((s) => s.options.length === 1)).toBe(true);
    });

    it("exposes one option per manaChoice for dual lands", () => {
        const [tundra] = buildAutoTapSources([
            makeInstance(TUNDRA, { id: "t1" }),
        ]);
        expect(tundra.options).toHaveLength(2);
        expect(tundra.options.map((o) => o.manaChoiceIndex)).toEqual([0, 1]);
    });

    it("excludes tapped sources", () => {
        const sources = buildAutoTapSources([
            makeInstance(FOREST, { id: "f1", isTapped: true }),
        ]);
        expect(sources).toEqual([]);
    });

    it("excludes sacrifice mana abilities (Black Lotus stays manual)", () => {
        const sources = buildAutoTapSources([
            makeInstance(BLACK_LOTUS, { id: "bl" }),
        ]);
        expect(sources).toEqual([]);
    });

    it("excludes summoning-sick creature dorks (CR 302.1)", () => {
        const sick = buildAutoTapSources([
            makeInstance(LLANOWAR, { id: "e1", isSummoningSick: true }),
        ]);
        expect(sick).toEqual([]);
        const ready = buildAutoTapSources([
            makeInstance(LLANOWAR, { id: "e1", isSummoningSick: false }),
        ]);
        expect(ready.map((s) => s.cardId)).toEqual(["e1"]);
    });

    it("includes Sol Ring as a 2-colorless fixed source", () => {
        const [sol] = buildAutoTapSources([
            makeInstance(SOL_RING, { id: "s1" }),
        ]);
        expect(sol.options).toEqual([{ mana: { C: 2 } }]);
    });

    it("sorts restricted sources before flexible ones", () => {
        const sources = buildAutoTapSources([
            makeInstance(BIRDS, { id: "birds", isSummoningSick: false }),
            makeInstance(ISLAND, { id: "isl" }),
        ]);
        // Island (1 option) must sort before Birds (5 options).
        expect(sources[0].cardId).toBe("isl");
        expect(sources[1].cardId).toBe("birds");
    });
});

describe("buildAutoTapSources + solveAutoTap — end to end", () => {
    it("pays {1}{U} from a battlefield of basics and a Birds", () => {
        const battlefield = [
            makeInstance(FOREST, { id: "f1" }),
            makeInstance(ISLAND, { id: "i1" }),
            makeInstance(BIRDS, { id: "b1", isSummoningSick: false }),
        ];
        const sources = buildAutoTapSources(battlefield);
        const plan = solveAutoTap(EMPTY_POOL, { U: 1, X: 1 }, [], sources);
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
        // Island (restricted U) is used for the U pip; Birds is kept unless
        // needed. The generic pip can be Forest or Birds.
        const ids = plan!.map((p) => p.cardId);
        expect(ids).toContain("i1");
    });
});
