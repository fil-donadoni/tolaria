import { describe, it, expect } from "vitest";
import {
    buildAutoTapSources,
    solveAutoTap,
    solveAutoTapPartial,
    solveSmartAutoTap,
    scorePreservedDemands,
    remainingFlexibility,
    AUTO_TAP_PLAN_CAP,
    type AutoTapSource,
    type Demand,
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

describe("solveAutoTapPartial — maximal useful subset (issue #321)", () => {
    it("taps all 5 Mountains toward a {7}{R} cost it can't fully cover", () => {
        // {7}{R} = R:1, generic 7. Five Mountains = 5 mana < 8 needed.
        // Black Lotus is excluded from sources (stays manual), so the partial
        // plan should tap every Mountain (all advance the cost).
        const sources = [
            fixed("m1", "R"),
            fixed("m2", "R"),
            fixed("m3", "R"),
            fixed("m4", "R"),
            fixed("m5", "R"),
        ];
        const plan = solveAutoTapPartial(
            EMPTY_POOL,
            { R: 1, X: 7 },
            [],
            sources
        );
        expect(plan.map((p) => p.cardId).sort()).toEqual([
            "m1",
            "m2",
            "m3",
            "m4",
            "m5",
        ]);
    });

    it("returns [] when no source can advance the cost (no over-tap)", () => {
        // Cost needs U only; only a Forest (G) is available — irrelevant.
        const plan = solveAutoTapPartial(
            EMPTY_POOL,
            { U: 1 },
            [],
            [fixed("forest", "G")]
        );
        expect(plan).toEqual([]);
    });

    it("never taps sources irrelevant to a partly-payable cost", () => {
        // Cost {R}{R}{R} (R:3). One Mountain + one Island. Island (U) is
        // irrelevant: only the Mountain should be tapped.
        const plan = solveAutoTapPartial(
            EMPTY_POOL,
            { R: 3 },
            [],
            [fixed("mtn", "R"), fixed("isl", "U")]
        );
        expect(plan).toEqual([{ cardId: "mtn" }]);
    });

    it("stops once the cost is fully covered (no over-tap)", () => {
        // {1} generic, three Mountains. Only one tap is needed even though the
        // partial solver would otherwise keep going.
        const plan = solveAutoTapPartial(
            EMPTY_POOL,
            { X: 1 },
            [],
            [fixed("m1", "R"), fixed("m2", "R"), fixed("m3", "R")]
        );
        expect(plan).toHaveLength(1);
    });

    it("picks the advancing option from a choice source", () => {
        // Cost {U}{U}{U}; a Tundra (W or U) should be tapped for U.
        const plan = solveAutoTapPartial(
            EMPTY_POOL,
            { U: 3 },
            [],
            [choice("tundra", ["W", "U"])]
        );
        expect(plan).toEqual([{ cardId: "tundra", manaChoiceIndex: 1 }]);
    });

    it("honors mana substitutions when judging usefulness", () => {
        // Cost {U}{U}; G can be spent as U. A single Forest advances it.
        const plan = solveAutoTapPartial(
            EMPTY_POOL,
            { U: 2 },
            [{ from: "G", to: "U" }],
            [fixed("forest", "G")]
        );
        expect(plan).toEqual([{ cardId: "forest" }]);
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

// ---------------------------------------------------------------------------
// Smart auto-tap: demand-aware minimal-tap selection (PRD #472, ADR 0034, #474)
//
// Auto-tap is CR-neutral UX (CR 601.2g does not dictate *which* legal sources a
// player taps). These tests pin the spine: the minimal-tap invariant, the
// preserved-Demand scorer, the 3-tier deterministic tie-break, the 512-plan cap
// fallback, and the empty-hand flexibility fallback.
// ---------------------------------------------------------------------------

/** Single-color demand cost helper. */
function demand(id: string, cost: Record<string, number>): Demand {
    return { id, cost };
}

describe("solveSmartAutoTap — minimal-tap invariant (ADR 0034)", () => {
    it("never taps more sources than the cost requires", () => {
        // {1}{U}: two taps, no more, even with four sources available.
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { U: 1, X: 1 },
            [],
            [
                choice("tundra", ["W", "U"]),
                fixed("island", "U"),
                choice("trop", ["U", "G"]),
                fixed("forest", "G"),
            ]
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
    });

    it("returns [] when the pool already covers the cost", () => {
        const plan = solveSmartAutoTap(
            { ...EMPTY_POOL, U: 1, R: 1 },
            { U: 1, X: 1 },
            [],
            [fixed("forest", "G")]
        );
        expect(plan).toEqual([]);
    });

    it("returns null when no combination can pay", () => {
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { W: 1 },
            [],
            [fixed("island", "U")]
        );
        expect(plan).toBeNull();
    });
});

describe("solveSmartAutoTap — preserved-Demand selection (ADR 0034)", () => {
    // The motivating bug (PRD #472 user story 2): board Tundra (W/U) + Island
    // (U) + Tropical Island (U/G); hand Savannah Lions ({W}); cast Time Walk
    // ({1}{U}). The plan must leave a white source (Tundra) untapped.
    it("Savannah Lions / Time Walk: leaves Tundra (a white source) untapped", () => {
        const sources = [
            choice("tundra", ["W", "U"]),
            fixed("island", "U"),
            choice("trop", ["U", "G"]),
        ];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { U: 1, X: 1 }, // Time Walk = {1}{U}
            [],
            sources,
            [demand("lions", { W: 1 })] // Savannah Lions
        );
        expect(plan).not.toBeNull();
        const tapped = plan!.map((p) => p.cardId);
        expect(tapped).not.toContain("tundra");
        expect(tapped.sort()).toEqual(["island", "trop"]);
    });

    it("prefers the plan that preserves the most affordable demands", () => {
        // Cast {U}: a single tap. Demands: a W spell and a U spell. Tapping the
        // mono-U island leaves plains (W) + the dual (W/U) → both demands stay
        // live (score 2). Tapping the W/U dual for the U pip would strand the U
        // demand against a lone plains (score 1). The higher-score plan wins.
        const sources = [
            fixed("plains", "W"),
            fixed("island", "U"),
            choice("trop", ["W", "U"]),
        ];
        const plan = solveSmartAutoTap(EMPTY_POOL, { U: 1 }, [], sources, [
            demand("wspell", { W: 1 }),
            demand("uspell", { U: 1 }),
        ]);
        expect(plan).not.toBeNull();
        // Taps the mono-U island; the dual and plains stay up for both demands.
        expect(plan!.map((p) => p.cardId)).toEqual(["island"]);
    });

    it("ignores demands that were unaffordable before payment", () => {
        // A {B} demand can't be paid from W/U sources at all — it must not skew
        // the choice (candidate filter (a): affordable-before-payment).
        const sources = [fixed("plains", "W"), fixed("island", "U")];
        const plan = solveSmartAutoTap(EMPTY_POOL, { W: 1 }, [], sources, [
            demand("bspell", { B: 1 }),
        ]);
        expect(plan).toEqual([{ cardId: "plains" }]);
    });
});

describe("scorePreservedDemands (ADR 0034 — per-demand isolation)", () => {
    it("counts a demand still affordable after payment, drops a stranded one", () => {
        const sources = [fixed("plains", "W"), fixed("island", "U")];
        // Pay {W} by tapping plains → island (U) remains. The U demand survives;
        // the W demand is stranded.
        const wPlan = [{ cardId: "plains" }];
        const score = scorePreservedDemands(
            EMPTY_POOL,
            { W: 1 },
            [],
            sources,
            wPlan,
            [demand("wspell", { W: 1 }), demand("uspell", { U: 1 })]
        );
        expect(score).toBe(1);
    });

    it("over-counts two demands sharing one surviving source (isolation accepted)", () => {
        // After paying, only one U source remains but two U demands both 'fit'
        // it in isolation — both count. ADR 0034 accepts this over-count.
        const sources = [fixed("forest", "G"), fixed("island", "U")];
        const plan = [{ cardId: "forest" }];
        const score = scorePreservedDemands(
            EMPTY_POOL,
            { G: 1 },
            [],
            sources,
            plan,
            [demand("u1", { U: 1 }), demand("u2", { U: 1 })]
        );
        expect(score).toBe(2);
    });

    it("uses leftover floating mana from an over-producing plan", () => {
        // Cost {1}; tapping Sol Ring ({C}{C}) covers it and floats one C. A {C}
        // demand survives off that floating mana even with no source left.
        const sources: AutoTapSource[] = [
            { cardId: "sol", options: [{ mana: { C: 2 } as never }] },
        ];
        const score = scorePreservedDemands(
            EMPTY_POOL,
            { X: 1 },
            [],
            sources,
            [{ cardId: "sol" }],
            [demand("art", { X: 1 })]
        );
        expect(score).toBe(1);
    });

    it("scores 0 with no demands", () => {
        const score = scorePreservedDemands(
            EMPTY_POOL,
            { W: 1 },
            [],
            [fixed("plains", "W")],
            [{ cardId: "plains" }],
            []
        );
        expect(score).toBe(0);
    });
});

describe("solveSmartAutoTap — flexibility tie-break / empty-hand fallback", () => {
    it("empty hand: spends the least-flexible source first (basics before duals)", () => {
        // Cost {1}: one tap. A mono-color Mountain vs a 2-color dual. With no
        // demands, tie-break #2 keeps the more flexible dual untapped → taps
        // the Mountain.
        const sources = [fixed("mountain", "R"), choice("trop", ["U", "G"])];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { X: 1 },
            [],
            sources,
            [] // empty hand
        );
        expect(plan).toEqual([{ cardId: "mountain" }]);
    });

    it("remainingFlexibility sums distinct colors of untapped sources", () => {
        const sources = [
            fixed("mountain", "R"), // 1 color
            choice("trop", ["U", "G"]), // 2 colors
        ];
        // Tapping the mountain leaves the 2-color dual → flexibility 2.
        expect(remainingFlexibility(sources, [{ cardId: "mountain" }])).toBe(2);
        // Tapping the dual leaves the mono mountain → flexibility 1.
        expect(remainingFlexibility(sources, [{ cardId: "trop" }])).toBe(1);
    });
});

describe("solveSmartAutoTap — determinism & cap (ADR 0034)", () => {
    it("same board casts twice → identical tapped set", () => {
        const build = () => [
            choice("tundra", ["W", "U"]),
            fixed("island", "U"),
            choice("trop", ["U", "G"]),
        ];
        const args = (s: AutoTapSource[]) =>
            solveSmartAutoTap(EMPTY_POOL, { U: 1, X: 1 }, [], s, [
                demand("lions", { W: 1 }),
            ]);
        const a = args(build());
        const b = args(build());
        expect(a).toEqual(b);
    });

    it("tertiary tie-break is lexicographic by tapped cardId", () => {
        // Two symmetric mono-R sources, cost {1}, no demands, equal flexibility
        // (both leave one R source, flexibility 1). Lexicographic 'a' < 'b'.
        const sources = [fixed("b-src", "R"), fixed("a-src", "R")];
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 1 }, [], sources, []);
        expect(plan).toEqual([{ cardId: "a-src" }]);
    });

    it("enforces the 512-plan cap without hanging on a wide board", () => {
        // 12 dual sources, cost {2}: a combinatorial explosion of 2-tap plans.
        // The cap bounds enumeration; the call must still return a valid 2-tap
        // plan quickly.
        const sources: AutoTapSource[] = [];
        for (let i = 0; i < 12; i++) {
            sources.push(choice(`d${i}`, ["U", "G"]));
        }
        const start = Date.now();
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 2 }, [], sources, []);
        const elapsed = Date.now() - start;
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
        expect(elapsed).toBeLessThan(1000);
        expect(AUTO_TAP_PLAN_CAP).toBe(512);
    });
});

// ---------------------------------------------------------------------------
// Self-source deprioritization (issue #544, CR 602.1 / 605.1a). When paying an
// activated ability's mana cost, the activating permanent's OWN mana ability
// must not be auto-tapped unless strictly necessary — otherwise a manland like
// Mishra's Factory animates itself tapped and can't attack/block. Class-wide:
// any activated ability whose source also has a mana ability.
// ---------------------------------------------------------------------------

describe("solveSmartAutoTap — self-source deprioritization (issue #544)", () => {
    it("spares the self-source when another source covers the cost", () => {
        // Mishra's Factory ("self") + a Forest, paying {1} (the animate cost).
        // Both can produce mana; the plan must tap the Forest, not the Factory.
        const sources = [fixed("self", "C"), fixed("forest", "G")];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { X: 1 },
            [],
            sources,
            [],
            "self"
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(1);
        expect(plan![0].cardId).toBe("forest");
    });

    it("taps the self-source when it is the only source (strictly necessary)", () => {
        // Only the Factory can pay {1}: tapping itself is unavoidable, and the
        // activation must still succeed rather than no-op.
        const sources = [fixed("self", "C")];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { X: 1 },
            [],
            sources,
            [],
            "self"
        );
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "self" }]);
    });

    it("taps the self-source when the cost exceeds the alternatives", () => {
        // {2} cost, alternatives provide only 1: the self-source is needed to
        // complete the payment (strictly necessary for the remainder).
        const sources = [fixed("self", "C"), fixed("forest", "G")];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { X: 2 },
            [],
            sources,
            [],
            "self"
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(2);
        expect(plan!.map((p) => p.cardId).sort()).toEqual(["forest", "self"]);
    });

    it("self-source needed for a color only it produces is still tapped", () => {
        // Cost {C} (colorless pip): only the Factory makes {C}; the Forest's {G}
        // can't substitute, so the Factory taps itself by necessity.
        const sources = [fixed("self", "C"), fixed("forest", "G")];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { C: 1 },
            [],
            sources,
            [],
            "self"
        );
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "self" }]);
    });

    it("no self-source id: unchanged behavior (regression guard)", () => {
        // Without selfSourceId the solver is free to pick either single source;
        // it must still return a minimal 1-tap plan.
        const sources = [fixed("self", "C"), fixed("forest", "C")];
        const plan = solveSmartAutoTap(EMPTY_POOL, { C: 1 }, [], sources, []);
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(1);
    });

    it("self-source id absent from sources: no-op deprioritization", () => {
        // selfSourceId names a permanent with no mana ability (not in sources):
        // the filter is a no-op and the solver behaves as if it weren't passed.
        const sources = [fixed("forest", "G")];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { G: 1 },
            [],
            sources,
            [],
            "manland-without-mana"
        );
        expect(plan).toEqual([{ cardId: "forest" }]);
    });

    it("deprioritization preserves the demand tie-break among non-self sources", () => {
        // Self (C) + Island (U) + Tundra (W/U), paying {1}. Tundra can also pay
        // a {W} Demand. The plan must spare both the self-source AND Tundra,
        // tapping the Island.
        const sources = [
            fixed("self", "C"),
            fixed("island", "U"),
            choice("tundra", ["W", "U"]),
        ];
        const demands: Demand[] = [{ id: "lions", cost: { W: 1 } }];
        const plan = solveSmartAutoTap(
            EMPTY_POOL,
            { X: 1 },
            [],
            sources,
            demands,
            "self"
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(1);
        expect(plan![0].cardId).toBe("island");
    });
});
