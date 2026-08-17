import { describe, it, expect } from "vitest";
import {
    buildAutoTapSources,
    solveAutoTap,
    solveAutoTapPartial,
    solveSmartAutoTap,
    scorePreservedDemands,
    remainingFlexibility,
    floatingAfterPlan,
    planSurplus,
    AUTO_TAP_PLAN_CAP,
    W_PRESERVED_DEMAND,
    SURPLUS_CAP,
    type AutoTapPlan,
    type AutoTapSource,
    type Demand,
} from "../autoTap";
import { evaluateAutoTapPosition } from "../evaluate";
import type { GameState, ManaSubstitution } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";

// Card ids (LEA set).
const FOREST = "6f1c8cb0-38eb-408b-94e8-16db83999b3b"; // {T}: G
const ISLAND = "90a57c0e-fa61-45ef-955d-d296403967d5"; // {T}: U
const TUNDRA = "a03e8c5b-f4ed-4fd7-ba05-db813ccc05eb"; // {T}: W or U
const BIRDS = "55fe6449-1f23-43dc-adee-d144cd505b5c"; // creature, any color
const MOX_EMERALD = "b0e1427c-05cd-465b-be59-97ed6e39f7ba"; // {T}: G
const SOL_RING = "c4300d24-1cae-4dd5-be7e-38cc677cf5bd"; // {T}: C C
const BLACK_LOTUS = "b0faa7f2-b547-42c4-a810-839da50dadfe"; // sacrifice
const LLANOWAR = "d4f1cc9e-4f99-4c26-ac1b-8ef069fa8ceb"; // creature, G
const GAEAS_CRADLE = "25b0b816-0583-44aa-9dc5-f3ff48993a51"; // {T}: G per creature you control
const GRIZZLY_BEARS = "ce2d603a-3231-4a8c-bf39-1617586ea870"; // vanilla creature, no mana ability

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

// ---------------------------------------------------------------------------
// Evaluation-scored smart auto-tap (issue #794, PRD #472 / ADR 0034).
//
// Among the minimal-tap covering plans, prefer the one whose resulting position
// the Brain's STATIC Evaluation rates highest for the paying player — leaving
// dual-purpose permanents (Mishra's Factory) and color-critical sources untapped
// whenever an equal-tap-count plan can pay without them. These tests exercise
// the real composition of the three target modules: `buildAutoTapSources`
// (autoTap) + a `scorePlan` closure (game.ts glue) over `evaluateAutoTapPosition`
// (evaluate) + `floatingAfterPlan` (autoTap), driving `solveSmartAutoTap`.
// ---------------------------------------------------------------------------
describe("evaluation-scored smart auto-tap (issue #794)", () => {
    const MISHRAS_FACTORY = "a696c5b6-f216-454d-8029-74e84bbd1428"; // {T}: C + animate

    /** Mirrors the `scoreAutoTapPlanPosition` closure game.ts builds: simulate
     *  the plan (tap its sources, apply leftover floating mana) then score the
     *  resulting position with the static Evaluation. */
    function makeScorer(
        state: GameState,
        playerId: string,
        pool: Record<string, number>,
        cost: Record<string, number>,
        substitutions: ManaSubstitution[],
        sources: AutoTapSource[]
    ) {
        return (plan: AutoTapPlan): number => {
            const sim = structuredClone(state) as GameState;
            const p = sim.players.find((x) => x.id === playerId)!;
            const tapped = new Set(plan.map((s) => s.cardId));
            for (const perm of p.battlefield) {
                if (tapped.has(perm.id)) perm.isTapped = true;
            }
            p.manaPool = floatingAfterPlan(
                pool,
                cost,
                substitutions,
                sources,
                plan
            );
            return evaluateAutoTapPosition(sim, playerId);
        };
    }

    it("AC1: leaves a dual-purpose manland untapped when a plain source can pay", () => {
        // Board: Mishra's Factory ({T}: C, plus animate) + a plain Forest ({T}: G).
        // Paying {1} generic is a one-tap cost either source covers. The
        // eval-scored plan must tap the Forest and SPARE the Factory (its animate
        // ability makes it worth more untapped — it can attack/block).
        const factory = makeInstance(MISHRAS_FACTORY, {
            id: "factory",
            controllerId: "p1",
        });
        const forest = makeInstance(FOREST, {
            id: "forest",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [factory, forest] }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        const sources = buildAutoTapSources(p1.battlefield);
        const cost = { X: 1 };
        const scorer = makeScorer(state, "p1", p1.manaPool, cost, [], sources);
        const plan = solveSmartAutoTap(
            p1.manaPool,
            cost,
            [],
            sources,
            [],
            undefined,
            scorer
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(1);
        expect(plan![0].cardId).toBe("forest");
    });

    it("AC2: preserves a color source a still-castable held spell needs", () => {
        // Board: Island ({T}: U) + Tundra ({T}: W or U). Paying {U} is a one-tap
        // cost either can cover. A held blue-white spell still wants {W}, which
        // ONLY Tundra can make. The eval-scored plan (color-flexible source is
        // worth more untapped) + the {W} Demand both point to tapping the Island
        // and sparing Tundra.
        const island = makeInstance(ISLAND, {
            id: "island",
            controllerId: "p1",
        });
        const tundra = makeInstance(TUNDRA, {
            id: "tundra",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [island, tundra] }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        const sources = buildAutoTapSources(p1.battlefield);
        const cost = { U: 1 };
        const demands: Demand[] = [{ id: "held-WW", cost: { W: 1 } }];
        const scorer = makeScorer(state, "p1", p1.manaPool, cost, [], sources);
        const plan = solveSmartAutoTap(
            p1.manaPool,
            cost,
            [],
            sources,
            demands,
            undefined,
            scorer
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(1);
        expect(plan![0].cardId).toBe("island");
    });

    it("with no scorer, behavior is the legacy demand→flex→lex order (backward-compatible)", () => {
        // Same board/cost as AC2 but no `scorePlan`: the {W} Demand + the
        // flexibility tie-break still spare Tundra, so the legacy path taps the
        // Island too — the new primary key defaults to a constant across plans.
        const island = makeInstance(ISLAND, {
            id: "island",
            controllerId: "p1",
        });
        const tundra = makeInstance(TUNDRA, {
            id: "tundra",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [island, tundra] }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        const sources = buildAutoTapSources(p1.battlefield);
        const demands: Demand[] = [{ id: "held-WW", cost: { W: 1 } }];
        const plan = solveSmartAutoTap(
            p1.manaPool,
            { U: 1 },
            [],
            sources,
            demands
        );
        expect(plan).not.toBeNull();
        expect(plan![0].cardId).toBe("island");
    });
});

// ---------------------------------------------------------------------------
// planSurplus (issue #2247) — the exact leftover pool a plan produces beyond
// what `cost` consumes (CR 500.4: it empties at end of step, so it's waste).
// ---------------------------------------------------------------------------
describe("planSurplus (issue #2247)", () => {
    it("is 0 when the plan's mana exactly covers the cost", () => {
        // Forest ({G}) pays a {G} cost exactly — nothing left over.
        const sources = [fixed("forest", "G")];
        const surplus = planSurplus(EMPTY_POOL, { G: 1 }, [], sources, [
            { cardId: "forest" },
        ]);
        expect(surplus).toBe(0);
    });

    it("counts the leftover when a multi-mana source over-pays a cost", () => {
        // Sol Ring ({C}{C}) pays a {1} cost: 1 mana consumed, 1 left over.
        const sources: AutoTapSource[] = [
            { cardId: "sol", options: [{ mana: { C: 2 } as never }] },
        ];
        const surplus = planSurplus(EMPTY_POOL, { X: 1 }, [], sources, [
            { cardId: "sol" },
        ]);
        expect(surplus).toBe(1);
    });

    it("is 0 when the cost consumes all of the source's mana (not over-production)", () => {
        // Sol Ring ({C}{C}) pays a {2} cost exactly.
        const sources: AutoTapSource[] = [
            { cardId: "sol", options: [{ mana: { C: 2 } as never }] },
        ];
        const surplus = planSurplus(EMPTY_POOL, { X: 2 }, [], sources, [
            { cardId: "sol" },
        ]);
        expect(surplus).toBe(0);
    });

    it("caps counted units at SURPLUS_CAP for a wildly over-producing source", () => {
        const sources: AutoTapSource[] = [
            { cardId: "huge", options: [{ mana: { C: 20 } as never }] },
        ];
        const surplus = planSurplus(EMPTY_POOL, { X: 1 }, [], sources, [
            { cardId: "huge" },
        ]);
        expect(surplus).toBe(SURPLUS_CAP);
        expect(SURPLUS_CAP).toBeLessThan(W_PRESERVED_DEMAND);
    });
});

// ---------------------------------------------------------------------------
// Surplus avoidance (issue #2247): the reported bug — smart auto-tap prefers
// tapping a multi-mana source (Sol Ring) over a single-mana land when only
// one mana is needed, wasting the surplus (it evaporates, CR 500.4). Among
// equal-tap-count plans, the ranking must now prefer the lowest-surplus one,
// strictly below preserved-Demand and strictly above source-quality/
// flexibility/lexicographic (see W_SURPLUS's doc, autoTap.ts).
// ---------------------------------------------------------------------------
describe("solveSmartAutoTap — surplus avoidance (issue #2247)", () => {
    it("AC1: taps the exact-fit land, leaves the over-producing rock untapped", () => {
        // Board: a generic 2-colorless-mana rock (any card shaped like Sol
        // Ring — deliberately NOT keyed to a specific card, see AC5 below)
        // plus a Forest. Cost {1}: either single tap covers it. The rock
        // would waste 1 mana (CR 500.4); the land wastes nothing.
        //
        // cardIds are deliberately chosen so the CORRECT answer ("z-land")
        // sorts AFTER the wrong one ("a-rock") lexicographically — the
        // lexicographic tie-break (tie-break #3) would otherwise pick
        // "a-rock" by alphabetical accident whenever the surplus term is
        // absent/broken, which would let this assertion pass for the wrong
        // reason (proof-of-failure check, see PR receipt).
        const sources: AutoTapSource[] = [
            { cardId: "a-rock", options: [{ mana: { C: 2 } as never }] },
            fixed("z-land", "G"),
        ];
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 1 }, [], sources, []);
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "z-land" }]);
    });

    it("AC2: no regression — taps the rock when the cost consumes all its mana", () => {
        // Cost {2}: the rock alone covers it in ONE tap with zero surplus.
        // The land alone can't reach {2} in one tap, so the minimal-tap plan
        // set is [rock] only — must still tap it, not fall back to a worse
        // (2-tap) plan or no plan at all.
        const sources: AutoTapSource[] = [
            { cardId: "rock", options: [{ mana: { C: 2 } as never }] },
            fixed("mountain", "R"),
        ];
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 2 }, [], sources, []);
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "rock" }]);
    });

    it("AC3: demand preservation still outranks surplus avoidance", () => {
        // Board: the rock (C C) + Forest (G). Cost {1}. A still-castable
        // held spell needs {G} — ONLY the Forest can pay it. Surplus
        // avoidance alone would tap the Forest (AC1's preference); the {G}
        // Demand must override that and force the rock to be tapped instead,
        // even though it wastes 1 mana.
        const sources: AutoTapSource[] = [
            { cardId: "rock", options: [{ mana: { C: 2 } as never }] },
            fixed("forest", "G"),
        ];
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 1 }, [], sources, [
            demand("gspell", { G: 1 }),
        ]);
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "rock" }]);
    });

    it("AC5: generic across any multi-mana producer — a differently-shaped rock behaves the same", () => {
        // Same shape as AC1 but a DIFFERENT card-agnostic multi-mana source
        // (3 red instead of 2 colorless), proving the preference is not
        // keyed to Sol Ring's specific output.
        const sources: AutoTapSource[] = [
            { cardId: "battery", options: [{ mana: { R: 3 } as never }] },
            fixed("mountain2", "R"),
        ];
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 1 }, [], sources, []);
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "mountain2" }]);
    });

    it("no lower-surplus alternative exists: taps the only available source", () => {
        // The rock is the sole source — surplus avoidance has nothing to
        // compare against, so the plan must still succeed (not return null).
        const sources: AutoTapSource[] = [
            { cardId: "rock", options: [{ mana: { C: 2 } as never }] },
        ];
        const plan = solveSmartAutoTap(EMPTY_POOL, { X: 1 }, [], sources, []);
        expect(plan).toEqual([{ cardId: "rock" }]);
    });

    it("a cost that consumes the rock's full output is not over-production (regression guard)", () => {
        // Cost {C}{C} matches the rock's exact output; a plain land can't
        // pay a colorless-pip cost at all here (only the rock produces C),
        // so tapping the rock is correct AND produces zero surplus.
        const sources: AutoTapSource[] = [
            { cardId: "rock", options: [{ mana: { C: 2 } as never }] },
            fixed("forest", "G"),
        ];
        const plan = solveSmartAutoTap(EMPTY_POOL, { C: 2 }, [], sources, []);
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "rock" }]);
    });
});

describe("solveSmartAutoTap — surplus avoidance outranks source quality (issue #2247, AC7)", () => {
    /** Mirrors the `scoreAutoTapPlanPosition` closure game.ts builds (same
     *  helper as the issue-#794 suite above). */
    function makeScorer(
        state: GameState,
        playerId: string,
        pool: Record<string, number>,
        cost: Record<string, number>,
        substitutions: ManaSubstitution[],
        sources: AutoTapSource[]
    ) {
        return (plan: AutoTapPlan): number => {
            const sim = structuredClone(state) as GameState;
            const p = sim.players.find((x) => x.id === playerId)!;
            const tapped = new Set(plan.map((s) => s.cardId));
            for (const perm of p.battlefield) {
                if (tapped.has(perm.id)) perm.isTapped = true;
            }
            p.manaPool = floatingAfterPlan(
                pool,
                cost,
                substitutions,
                sources,
                plan
            );
            return evaluateAutoTapPosition(sim, playerId);
        };
    }

    it("taps the multi-mana single-color rock even though sparing the dual scores higher on breadth", () => {
        // Board: Sol Ring (C C, single "color", no dual-purpose ability) +
        // Tundra (choice W/U, breadth 2 — the position scorer's
        // untappedSourceQuality rewards SPARING it). Cost {1}: either single
        // tap covers it.
        //   - Tap Tundra: 0 surplus, spares Sol Ring (breadth 1, quality +0).
        //   - Tap Sol Ring: 1 surplus, spares Tundra (breadth 2, quality +4).
        // The eval alone would reward sparing the higher-breadth Tundra;
        // surplus avoidance must dominate that and still tap Tundra.
        const solRing = makeInstance(SOL_RING, {
            id: "sol",
            controllerId: "p1",
        });
        const tundra = makeInstance(TUNDRA, {
            id: "tundra",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [solRing, tundra] }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        const sources = buildAutoTapSources(p1.battlefield);
        const cost = { X: 1 };
        const scorer = makeScorer(state, "p1", p1.manaPool, cost, [], sources);
        const plan = solveSmartAutoTap(
            p1.manaPool,
            cost,
            [],
            sources,
            [],
            undefined,
            scorer
        );
        expect(plan).not.toBeNull();
        expect(plan).toHaveLength(1);
        expect(plan![0].cardId).toBe("tundra");
    });
});

describe("solveSmartAutoTap — board-derived surplus (issue #2247, AC6)", () => {
    it("prices Gaea's Cradle by its CURRENT board-derived output, not a static amount", () => {
        // Gaea's Cradle: "{T}: Add {G} for each creature you control." With 3
        // vanilla creatures on board it currently makes G:3 — a live amount
        // `buildAutoTapSources` resolves through `getManaTapOptionsDetailed`
        // BEFORE the solver ever sees the source, so `planSurplus` reads the
        // same board-aware number the real payment path would add. A Forest
        // covers the {1} cost exactly; Cradle would waste 2.
        const cradle = makeInstance(GAEAS_CRADLE, {
            id: "cradle",
            controllerId: "p1",
        });
        const forest = makeInstance(FOREST, {
            id: "forest",
            controllerId: "p1",
        });
        const bear1 = makeInstance(GRIZZLY_BEARS, {
            id: "bear1",
            controllerId: "p1",
        });
        const bear2 = makeInstance(GRIZZLY_BEARS, {
            id: "bear2",
            controllerId: "p1",
        });
        const bear3 = makeInstance(GRIZZLY_BEARS, {
            id: "bear3",
            controllerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [cradle, forest, bear1, bear2, bear3],
                }),
                makePlayer("p2"),
            ],
        });
        const p1 = state.players[0];
        const sources = buildAutoTapSources(p1.battlefield, [
            { playerId: "p1", battlefield: p1.battlefield },
            { playerId: "p2", battlefield: state.players[1].battlefield },
        ]);
        // Confirm the board-aware amount actually resolved to 3, not the
        // representative 1-creature fallback (`manaProduced`) — otherwise
        // this test would pass for the wrong reason.
        const cradleSource = sources.find((s) => s.cardId === "cradle");
        expect(cradleSource?.options[0]?.mana).toEqual({ G: 3 });

        const plan = solveSmartAutoTap(p1.manaPool, { X: 1 }, [], sources, []);
        expect(plan).not.toBeNull();
        expect(plan).toEqual([{ cardId: "forest" }]);
    });
});
