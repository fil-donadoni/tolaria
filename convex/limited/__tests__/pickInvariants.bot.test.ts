// Pick Invariants (PRD #1607, ADR 0073, issues #1609/#1610) — the FIRST
// batch, extended with the pip-weighted Colour Commitment / Castability /
// Fixing Value terms (issue #1610).
//
// A gameplay move has a ground truth: a move that loses by force of rules is
// wrong. A DRAFT PICK has none — every pick is defensible — so a test asserting
// "the bot picks X" records an OPINION and then defends it against every future
// retune. These tests therefore assert only the DIRECTION the model must
// respond in, plus the structural guarantees of the score's composition:
//
//   * adding an on-colour card may not LOWER a same-colour candidate's score
//   * adding an off-colour card may not RAISE a candidate's colour term
//   * filling a candidate's curve bucket may not RAISE its curve term
//   * raising a candidate's rating may not LOWER its score
//   * the score is exactly the sum of its breakdown, and the contextual sum
//     lives in [0, the pick's contextual cap] — fit is a BONUS, never a
//     penalty, so the cap bounds the GAP context can open between two
//     candidates rather than each candidate's own sum (issue #1609 review)
//   * a rating gap wider than the pick's cap is never overturned by context
//   * `packsSeen` is unread, so supplying it may not change any pick
//   * a mana source is worth more Fixing Value to a Pool short of a colour
//     than to one already served in it (issue #1610)
//   * a candidate the Pool cannot cast may not outscore an otherwise
//     identical castable one (issue #1610)
//   * a mana source raises Colour Commitment strictly less than a
//     double-pipped spell of the same colour (issue #1610)
//
// Every one of these holds for ANY positive weighting: retuning
// `COLOUR_COMMIT_RATING_PER_UNIT`, the curve weight, the cap endpoints or the
// cap's exponent must never redden one. Only a BROKEN model does — an inverted
// term, a term not reading the Pool it claims to, a cap that shrinks as the
// deck grows, a "provenance" naming cards that are not in the Pool.
//
// Deliberately NOT here: consensus "Anchor Picks" (e.g. "Black Lotus is taken
// from a pack with no other Power Nine"). ADR 0073 files those separately,
// because a red Anchor calls for a human decision — accept and restate, or
// revert — never an automatic weight fix.
import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import {
    getDefinitionProducibleColors,
    manaValue,
} from "../../gre/constants";
import {
    CONTEXT_CAP_FIRST_PICK,
    CONTEXT_CAP_LAST_PICK,
    DEFAULT_DRAFT_PICKS,
    candidateQuality,
    chooseBotPick,
    contextCapForPick,
    heuristicAsRating,
    isContextualTerm,
    scoreCandidate,
    scorePack,
    type CardEvalMeta,
    type GetCardEvalMeta,
    type PickCandidateTrace,
    type PickTermKey,
} from "../botDrafter";
import type { DraftPackCard } from "../eventTypes";
import { PICK_RATING_MAX, PICK_RATING_MIN } from "../pickRatings";

function metaOf(name: string, over: Partial<CardEvalMeta> = {}): CardEvalMeta {
    const def = getCardByName(name);
    return {
        cardId: def.id,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: def.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
        ...over,
    };
}

/** Green 2-drop / green 5-drop / red 3-drop reference cards. Real registry
 *  cards (so the quality fallback resolves), with the field under test
 *  overridden — the same isolation discipline `botDrafter.bot.test.ts` uses.
 *  Craw Wurm's REAL cost is `{4}{G}{G}` — its `pips` is `{ G: 2 }` by
 *  default, a genuine double-pipped spell the Colour Commitment tests below
 *  lean on. */
const greenTwoDrop = metaOf("Grizzly Bears", { colors: ["G"], manaValue: 2 });
const greenFiveDrop = metaOf("Craw Wurm", { colors: ["G"], manaValue: 5 });
const redThreeDrop = metaOf("Hill Giant", { colors: ["R"], manaValue: 3 });
/** Curve-neutral filler (mana value 0), so adding it to a Pool moves the
 *  colour signal WITHOUT touching the curve signal. Pips are left at the
 *  underlying card's real value (`{G:1}` / `{R:1}`) — still a genuine
 *  on-colour SPELL for Colour Commitment purposes. */
const greenFiller = metaOf("Grizzly Bears", { colors: ["G"], manaValue: 0 });
const redFiller = metaOf("Hill Giant", { colors: ["R"], manaValue: 0 });
/** A same-cardId blue filler (Colour Commitment / Fixing Value tests need a
 *  third colour alongside green/red). */
const blueFiller = metaOf("Grizzly Bears", {
    colors: ["U"],
    manaValue: 0,
    pips: { U: 1 },
});

/** Pure MANA SOURCES (ADR 0073, issue #1610): `pips: {}` — a candidate scores
 *  0 Colour Commitment for picking one of these (it has no coloured pip
 *  requirement of its own) — but `producedColors` is non-empty, which is
 *  exactly what Castability / Fixing Value read. Real registry lands, so
 *  `producedColors` comes from `getDefinitionProducibleColors` exactly
 *  the way `convex/limitedEvents.ts` computes it in production. */
const forest = metaOf("Forest");
const mountain = metaOf("Mountain");
const island = metaOf("Island");
/** The PRD's own worked Fixing Value example (ADR 0073): "a Temur pool heavy
 *  in {R} pips and short on red sources values Volcanic Island over Tropical
 *  Island though both are on-colour duals." */
const volcanicIsland = metaOf("Volcanic Island");
const tropicalIsland = metaOf("Tropical Island");

function termValue(
    trace: PickCandidateTrace,
    term: PickTermKey,
    field: "value" | "rawValue" = "rawValue"
): number {
    const found = trace.terms.find((t) => t.term === term);
    if (!found) throw new Error(`no ${term} term in trace`);
    return found[field];
}

/** Pools of every depth an invariant should hold at — an empty Pool (pick 1,
 *  no deck to respect), inside the off-colour grace window, just past it, and
 *  a deep, heavily committed Pool. */
const POOL_DEPTHS = [0, 1, 3, 4, 8, 20, 40];

describe("Pick Invariant — the score IS its breakdown (ADR 0073)", () => {
    it("every trace's score equals the sum of its terms, at every Pool depth and rating", () => {
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(greenFiller) as CardEvalMeta[];
            for (const rating of [
                null,
                PICK_RATING_MIN,
                2.5,
                PICK_RATING_MAX,
            ]) {
                for (const candidate of [
                    greenTwoDrop,
                    greenFiveDrop,
                    redThreeDrop,
                ]) {
                    const trace = scoreCandidate(candidate, pool, rating);
                    // Summed INLINE, deliberately not via the SUT's own
                    // `sumTraceTerms`: `trace.score` is literally assigned
                    // that call, so asserting one against the other is a
                    // tautology. An independent sum is what would bite if a
                    // second arithmetic path ever appeared.
                    const summed = trace.terms.reduce((s, t) => s + t.value, 0);
                    expect(trace.score).toBeCloseTo(summed, 12);
                }
            }
        }
    });

    it("the sum of every contextual term stays inside [0, cap] — fit is a BONUS, never a penalty", () => {
        // The floor matters as much as the ceiling (issue #1609 review): with a
        // symmetric ±cap clamp each candidate is bounded but the GAP two
        // candidates can open on context alone is 2 × cap, so the cap stops
        // answering the question it exists to answer. A non-negative sum makes
        // the cap the bound on the differential — see the invariant below.
        for (const depth of POOL_DEPTHS) {
            // A mixed Pool so every contextual term is genuinely non-zero,
            // and candidates on-colour, off-colour and colourless so the
            // no-fit cases are covered too.
            const pool = [
                ...Array(depth).fill(greenTwoDrop),
                ...Array(depth).fill(redFiller),
                ...Array(Math.min(depth, 3)).fill(mountain),
            ] as CardEvalMeta[];
            for (const candidate of [
                greenTwoDrop,
                greenFiveDrop,
                redThreeDrop,
                volcanicIsland,
                { ...greenTwoDrop, colors: [], pips: {}, producedColors: [] },
                { ...greenTwoDrop, colors: ["W"], pips: { W: 1 } },
            ] as CardEvalMeta[]) {
                const trace = scoreCandidate(candidate, pool, 3);
                const contextual = trace.terms
                    .filter((t) => isContextualTerm(t.term))
                    .reduce((sum, t) => sum + t.value, 0);
                expect(contextual).toBeGreaterThanOrEqual(-1e-9);
                expect(contextual).toBeLessThanOrEqual(trace.contextCap + 1e-9);
                // No individual term may be a penalty either — a structurally
                // ≤ 0 term is dead weight under a non-negative clamp, so its
                // presence means someone wrote one and it silently does
                // nothing.
                for (const term of trace.terms) {
                    if (!isContextualTerm(term.term)) continue;
                    expect(term.rawValue).toBeGreaterThanOrEqual(0);
                    expect(term.value).toBeGreaterThanOrEqual(0);
                }
            }
        }
    });

    it("the clamp is reconstructible from the breakdown alone — no invisible adjustment between the terms and the score", () => {
        // ADR 0073 forbids a shadow narrator; the cap must therefore be
        // legible off the trace rather than applied behind it. A reader with
        // only `terms[].rawValue`, `contextScale` and `contextCap` must be
        // able to rebuild `score` exactly.
        const pool = Array(40).fill(greenTwoDrop) as CardEvalMeta[];
        const trace = scoreCandidate(greenTwoDrop, pool, 3);
        const rawSum = trace.terms
            .filter((t) => isContextualTerm(t.term))
            .reduce((sum, t) => sum + t.rawValue, 0);
        const base = trace.terms.find((t) => !isContextualTerm(t.term))!;
        const clamped = Math.min(trace.contextCap, Math.max(0, rawSum));
        expect(trace.score).toBeCloseTo(base.value + clamped, 12);
        for (const term of trace.terms.filter((t) =>
            isContextualTerm(t.term)
        )) {
            expect(term.value).toBeCloseTo(
                term.rawValue * trace.contextScale,
                12
            );
        }
        // And when the cap binds, every scaled line SAYS it was scaled.
        expect(trace.contextScale).toBeLessThan(1);
        for (const term of trace.terms.filter((t) =>
            isContextualTerm(t.term)
        )) {
            expect(term.note).toContain("context cap");
        }
    });

    it("a term's provenance only ever names cards that are actually in the Pool", () => {
        const pool = [greenTwoDrop, greenFiller, redFiller, mountain];
        const poolIds = new Set(pool.map((c) => c.cardId));
        for (const candidate of [greenTwoDrop, redThreeDrop, volcanicIsland]) {
            for (const term of scoreCandidate(candidate, pool, null).terms) {
                for (const source of term.sources) {
                    expect(poolIds.has(source.cardId)).toBe(true);
                    expect(source.reason.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it("a non-zero contextual term always names at least one responsible Pool card", () => {
        // Castability's "no coloured pips — trivially castable" branch is a
        // deliberate exception: that bonus is a property of the CANDIDATE
        // (nothing to pay for), not of any specific Pool card, so it is
        // exercised separately (`castability responds in the right
        // direction` below) rather than folded into this general sweep.
        const pool = [
            ...(Array(6).fill(greenTwoDrop) as CardEvalMeta[]),
            mountain,
        ];
        const trace = scoreCandidate(greenTwoDrop, pool, null);
        for (const term of trace.terms.filter((t) =>
            isContextualTerm(t.term)
        )) {
            if (term.rawValue !== 0) {
                expect(term.sources.length).toBeGreaterThan(0);
            }
        }
    });
});

describe("Pick Invariant — the contextual cap grows with the pick (ADR 0073)", () => {
    it("is monotonically non-decreasing in the pick number", () => {
        let previous = -Infinity;
        for (let pick = 1; pick <= DEFAULT_DRAFT_PICKS + 20; pick++) {
            const cap = contextCapForPick(pick);
            expect(cap).toBeGreaterThanOrEqual(previous);
            previous = cap;
        }
    });

    it("is bounded at both ends — the first pick's cap at the floor, never above the last pick's", () => {
        expect(contextCapForPick(1)).toBeCloseTo(CONTEXT_CAP_FIRST_PICK, 12);
        expect(contextCapForPick(DEFAULT_DRAFT_PICKS)).toBeCloseTo(
            CONTEXT_CAP_LAST_PICK,
            12
        );
        // Past the end of the draft it clamps rather than running away.
        expect(contextCapForPick(DEFAULT_DRAFT_PICKS * 3)).toBeCloseTo(
            CONTEXT_CAP_LAST_PICK,
            12
        );
        // And context can never outweigh the rating scale it refines.
        expect(CONTEXT_CAP_LAST_PICK).toBeLessThan(
            PICK_RATING_MAX - PICK_RATING_MIN
        );
    });

    it("a candidate's cap is the cap for its Pool depth — context grows because the DECK grew", () => {
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(greenFiller) as CardEvalMeta[];
            const trace = scoreCandidate(greenTwoDrop, pool, 3);
            expect(trace.pickNumber).toBe(depth + 1);
            expect(trace.contextCap).toBeCloseTo(
                contextCapForPick(depth + 1),
                12
            );
        }
    });
});

describe("Pick Invariant — the cap bounds the DIFFERENTIAL (ADR 0073, issue #1609)", () => {
    /** The widest contextual spread the current term set can produce at one
     *  Pool: perfect fit (on-colour, empty curve bucket) through no fit at all
     *  (off-colour, saturated bucket), plus the colourless case. Adding a term
     *  widens the spread without touching these invariants — they name no
     *  weight, no threshold and no cap constant. */
    const SPREAD: CardEvalMeta[] = [
        { ...greenTwoDrop, manaValue: 5 },
        { ...greenTwoDrop, manaValue: 3 },
        { ...redThreeDrop, manaValue: 5 },
        { ...redThreeDrop, manaValue: 3 },
        {
            ...greenTwoDrop,
            colors: [],
            pips: {},
            producedColors: [],
            manaValue: 5,
        },
    ];
    const RATINGS = [PICK_RATING_MIN, 1.5, 2.5, 3.5, PICK_RATING_MAX];

    /** Deep single-colour commitment plus a saturated MV-3 bucket — the Pool
     *  that pulls hardest on every contextual term at once. */
    function hostilePool(depth: number): CardEvalMeta[] {
        return [
            ...Array(depth).fill(greenFiller),
            ...Array(depth).fill({ ...greenFiller, manaValue: 3 }),
        ] as CardEvalMeta[];
    }

    it("context may move two candidates apart by at most the pick's cap — never twice it", () => {
        // The bound is on the GAP, not on each candidate's contextual sum. A
        // symmetric ±cap clamp satisfies the per-candidate bound and still
        // lets a 1.9 cap overturn a 3.8-point rating gap; this is the
        // invariant that tells the two apart.
        for (const depth of POOL_DEPTHS) {
            const pool = hostilePool(depth);
            const cap = contextCapForPick(pool.length + 1);
            for (const a of SPREAD) {
                for (const b of SPREAD) {
                    for (const ratingA of RATINGS) {
                        for (const ratingB of RATINGS) {
                            const scoreGap =
                                scoreCandidate(a, pool, ratingA).score -
                                scoreCandidate(b, pool, ratingB).score;
                            expect(
                                Math.abs(scoreGap - (ratingA - ratingB))
                            ).toBeLessThanOrEqual(cap + 1e-9);
                        }
                    }
                }
            }
        }
    });

    it("a rating gap WIDER than the pick's cap is never overturned, however hostile the Pool", () => {
        // Direction-only and weight-independent: the gap under test is read
        // off `contextCapForPick` itself, so retuning the endpoints or the
        // ramp's exponent moves the gap with it and never reddens this.
        for (const depth of POOL_DEPTHS) {
            const pool = hostilePool(depth);
            const cap = contextCapForPick(pool.length + 1);
            const lowRating = PICK_RATING_MIN;
            const highRating = lowRating + cap + 1e-6;
            expect(highRating).toBeLessThanOrEqual(PICK_RATING_MAX);
            for (const favoured of SPREAD) {
                for (const disfavoured of SPREAD) {
                    expect(
                        scoreCandidate(disfavoured, pool, highRating).score
                    ).toBeGreaterThan(
                        scoreCandidate(favoured, pool, lowRating).score
                    );
                }
            }
        }
    });
});

describe("Pick Invariant — colour commitment responds in the right direction", () => {
    it("adding an on-colour card may not LOWER a same-colour candidate's score", () => {
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(greenFiller) as CardEvalMeta[];
            const before = scoreCandidate(greenTwoDrop, pool, 3).score;
            const after = scoreCandidate(
                greenTwoDrop,
                [...pool, greenFiller],
                3
            ).score;
            expect(after).toBeGreaterThanOrEqual(before - 1e-12);
        }
    });

    it("adding an on-colour card may not LOWER the colour term itself", () => {
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(greenFiller) as CardEvalMeta[];
            expect(
                termValue(
                    scoreCandidate(greenTwoDrop, [...pool, greenFiller], 3),
                    "colourCommitment"
                )
            ).toBeGreaterThanOrEqual(
                termValue(
                    scoreCandidate(greenTwoDrop, pool, 3),
                    "colourCommitment"
                ) - 1e-12
            );
        }
    });

    it("adding a card sharing NO colour with the candidate may not RAISE its colour term", () => {
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(redFiller) as CardEvalMeta[];
            expect(
                termValue(
                    scoreCandidate(greenTwoDrop, [...pool, redFiller], 3),
                    "colourCommitment"
                )
            ).toBeLessThanOrEqual(
                termValue(
                    scoreCandidate(greenTwoDrop, pool, 3),
                    "colourCommitment"
                ) + 1e-12
            );
        }
    });

    it("a candidate on the Pool's colour is never worth LESS (in colour terms) than one sharing none of it", () => {
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(greenFiller) as CardEvalMeta[];
            const onColour = termValue(
                scoreCandidate(greenTwoDrop, pool, 3),
                "colourCommitment"
            );
            const offColour = termValue(
                scoreCandidate(
                    { ...greenTwoDrop, colors: ["R"], pips: { R: 1 } },
                    pool,
                    3
                ),
                "colourCommitment"
            );
            expect(onColour).toBeGreaterThanOrEqual(offColour - 1e-12);
        }
    });

    it("a candidate with no coloured pips (a land / mana source) may never RAISE its own colour term", () => {
        // Volcanic Island produces {U}/{R} but has NO coloured pips of its
        // own (`pips: {}`) — taking it must not marry the seat to a colour
        // by THIS term (ADR 0073, PRD #1607: "the classic way these bots
        // derail"). Fixing Value is where its worth as a SOURCE is scored.
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(redFiller) as CardEvalMeta[];
            expect(
                termValue(
                    scoreCandidate(volcanicIsland, pool, 3),
                    "colourCommitment"
                )
            ).toBe(0);
        }
    });

    it("a Pool MANA SOURCE raises a same-colour candidate's Commitment term strictly LESS than a double-pipped spell of that colour does", () => {
        // The load-bearing half of "mana sources contribute at a lower
        // weight than spells" (ADR 0073, issue #1610): a dual land FOLLOWS
        // commitment, it never CREATES it. Holds for ANY positive per-unit
        // weighting as long as a mana source's per-colour contribution stays
        // below a single pip's — the design constraint the constants encode,
        // not a specific tuned number.
        const doubleRedPipSpell: CardEvalMeta = {
            ...redThreeDrop,
            pips: { R: 2 },
            producedColors: [],
        };
        const basePool = Array(5).fill(greenFiller) as CardEvalMeta[];
        const afterSource = termValue(
            scoreCandidate(redThreeDrop, [...basePool, mountain], 3),
            "colourCommitment"
        );
        const afterSpell = termValue(
            scoreCandidate(redThreeDrop, [...basePool, doubleRedPipSpell], 3),
            "colourCommitment"
        );
        expect(afterSource).toBeLessThan(afterSpell);
    });
});

describe("Pick Invariant — curve fit responds in the right direction", () => {
    it("adding a card in the candidate's own curve bucket may not RAISE its curve term", () => {
        const sameBucket = {
            ...greenFiller,
            manaValue: greenTwoDrop.manaValue,
        };
        let pool: CardEvalMeta[] = [];
        let previous = termValue(
            scoreCandidate(greenTwoDrop, pool, 3),
            "curveFit"
        );
        for (let i = 0; i < 8; i++) {
            pool = [...pool, sameBucket];
            const next = termValue(
                scoreCandidate(greenTwoDrop, pool, 3),
                "curveFit"
            );
            expect(next).toBeLessThanOrEqual(previous + 1e-12);
            previous = next;
        }
    });

    it("adding a card in a DIFFERENT bucket may not LOWER the candidate's curve term", () => {
        const otherBucket = {
            ...greenFiller,
            manaValue: greenFiveDrop.manaValue,
        };
        let pool: CardEvalMeta[] = [];
        let previous = termValue(
            scoreCandidate(greenTwoDrop, pool, 3),
            "curveFit"
        );
        for (let i = 0; i < 8; i++) {
            pool = [...pool, otherBucket];
            const next = termValue(
                scoreCandidate(greenTwoDrop, pool, 3),
                "curveFit"
            );
            expect(next).toBeGreaterThanOrEqual(previous - 1e-12);
            previous = next;
        }
    });

    it("a candidate whose bucket is saturated is never worth MORE (in curve terms) than one whose bucket is empty", () => {
        const pool = Array(8).fill({
            ...greenFiller,
            manaValue: greenTwoDrop.manaValue,
        }) as CardEvalMeta[];
        expect(
            termValue(scoreCandidate(greenTwoDrop, pool, 3), "curveFit")
        ).toBeLessThanOrEqual(
            termValue(scoreCandidate(greenFiveDrop, pool, 3), "curveFit") +
                1e-12
        );
    });
});

describe("Pick Invariant — castability responds in the right direction (ADR 0073, issue #1610)", () => {
    it("adding a mana SOURCE of the candidate's colour may not LOWER its Castability term", () => {
        let pool: CardEvalMeta[] = [];
        let previous = termValue(
            scoreCandidate(redThreeDrop, pool, 3),
            "castability"
        );
        for (let i = 0; i < 5; i++) {
            pool = [...pool, mountain];
            const next = termValue(
                scoreCandidate(redThreeDrop, pool, 3),
                "castability"
            );
            expect(next).toBeGreaterThanOrEqual(previous - 1e-12);
            previous = next;
        }
    });

    it("adding a mana source of a DIFFERENT colour may not RAISE the candidate's Castability term", () => {
        let pool: CardEvalMeta[] = [mountain, mountain, mountain];
        const before = termValue(
            scoreCandidate(redThreeDrop, pool, 3),
            "castability"
        );
        pool = [...pool, forest, forest, forest];
        const after = termValue(
            scoreCandidate(redThreeDrop, pool, 3),
            "castability"
        );
        expect(after).toBeLessThanOrEqual(before + 1e-12);
    });

    it("a candidate whose colour the Pool cannot source scores LOWER Castability than an otherwise identical candidate whose colour the Pool CAN source", () => {
        const pool = [forest, forest]; // 2 green sources, 0 red sources
        const sourced = { ...greenTwoDrop, pips: { G: 1 } };
        const unsourced = { ...redThreeDrop, pips: { R: 1 } };
        const sourcedCastability = termValue(
            scoreCandidate(sourced, pool, 3),
            "castability"
        );
        const unsourcedCastability = termValue(
            scoreCandidate(unsourced, pool, 3),
            "castability"
        );
        expect(sourcedCastability).toBeGreaterThan(unsourcedCastability);
    });

    it("a candidate with no coloured pips always maxes Castability, regardless of the Pool's sources", () => {
        // ADR 0073's refinement note: the non-negative clamp made
        // `colourCommitment` alone unable to tell a colourless card apart
        // from an actively off-colour one (both score 0 there) —
        // Castability is where that distinction now lives.
        const colourless: CardEvalMeta = {
            ...greenTwoDrop,
            colors: [],
            pips: {},
            producedColors: [],
        };
        for (const pool of [
            [] as CardEvalMeta[],
            [forest],
            [mountain, mountain, mountain],
        ]) {
            const colourlessCastability = termValue(
                scoreCandidate(colourless, pool, 3),
                "castability"
            );
            const offColour = termValue(
                scoreCandidate({ ...redThreeDrop, pips: { R: 1 } }, pool, 3),
                "castability"
            );
            expect(colourlessCastability).toBeGreaterThanOrEqual(offColour);
        }
    });

    it("a candidate the Pool cannot cast may not outscore an otherwise identical castable one", () => {
        // Same pip demand, same base rating, curve-neutral (manaValue 0) —
        // the ONLY thing that differs is which colour the Pool can source.
        const pool: CardEvalMeta[] = [
            ...Array(4).fill(blueFiller), // U pip demand, kept equal for both colours below
            ...Array(4).fill({ ...blueFiller, colors: ["B"], pips: { B: 1 } }), // B pip demand, matched to U
            ...Array(3).fill(island), // sources for U only — none for B
        ];
        const castableU: CardEvalMeta = {
            ...greenTwoDrop,
            colors: ["U"],
            pips: { U: 1 },
            producedColors: [],
            manaValue: 0,
        };
        const uncastableB: CardEvalMeta = {
            ...greenTwoDrop,
            colors: ["B"],
            pips: { B: 1 },
            producedColors: [],
            manaValue: 0,
        };
        const castableScore = scoreCandidate(castableU, pool, 3).score;
        const uncastableScore = scoreCandidate(uncastableB, pool, 3).score;
        expect(uncastableScore).toBeLessThanOrEqual(castableScore);
    });
});

describe("Pick Invariant — fixing value responds in the right direction (ADR 0073, issue #1610)", () => {
    it("a mana source scores 0 Fixing Value when the Pool has no pip demand for any colour it produces", () => {
        for (const pool of [
            [] as CardEvalMeta[],
            [forest, forest],
            Array(5).fill(greenFiller) as CardEvalMeta[],
        ]) {
            // Volcanic Island produces {U}/{R} — an all-green Pool has zero
            // demand for either, so there is nothing to relieve.
            expect(
                termValue(
                    scoreCandidate(volcanicIsland, pool, null),
                    "fixingValue"
                )
            ).toBe(0);
        }
    });

    it("a source is worth strictly MORE Fixing Value to a Pool SHORT of that colour than to one already SERVED (ADR 0073 acceptance)", () => {
        const demand = Array(6).fill(redFiller) as CardEvalMeta[]; // 6 R pips demand
        const poolShort = [...demand]; // 0 existing red sources
        const poolServed = [...demand, ...Array(6).fill(mountain)]; // demand fully sourced already
        const short = termValue(
            scoreCandidate(mountain, poolShort, null),
            "fixingValue"
        );
        const served = termValue(
            scoreCandidate(mountain, poolServed, null),
            "fixingValue"
        );
        expect(short).toBeGreaterThan(served);
    });

    it("a 12-pip-red Pool never values a red source below a 2-pip-red Pool (ADR 0073 acceptance)", () => {
        const pool12 = Array(12).fill(redFiller) as CardEvalMeta[];
        const pool2 = Array(2).fill(redFiller) as CardEvalMeta[];
        const value12 = termValue(
            scoreCandidate(mountain, pool12, null),
            "fixingValue"
        );
        const value2 = termValue(
            scoreCandidate(mountain, pool2, null),
            "fixingValue"
        );
        expect(value12).toBeGreaterThanOrEqual(value2);
    });

    it("increasing the Pool's existing sources of a colour never RAISES a new source's Fixing Value for that colour", () => {
        const demand = Array(9).fill(redFiller) as CardEvalMeta[]; // fixed R pip demand
        let previous = termValue(
            scoreCandidate(mountain, demand, null),
            "fixingValue"
        );
        let pool = [...demand];
        for (let i = 0; i < 4; i++) {
            pool = [...pool, mountain];
            const next = termValue(
                scoreCandidate(mountain, pool, null),
                "fixingValue"
            );
            expect(next).toBeLessThanOrEqual(previous + 1e-12);
            previous = next;
        }
    });

    it("Fixing Value favours the colour actually SHORT: a Temur Pool heavy in {R} pips and thin on red sources values Volcanic Island over Tropical Island (PRD #1607 worked example)", () => {
        // 9 {R} pips, 1 red source (the PRD's own numbers) — U and G demand
        // fully covered by existing sources, so their deficits are zero and
        // only the red deficit separates the two duals.
        const temurPool: CardEvalMeta[] = [
            ...(Array(9).fill(redFiller) as CardEvalMeta[]), // 9 R pips demand
            mountain, // 1 red source
            ...(Array(2).fill(blueFiller) as CardEvalMeta[]), // 2 U pips demand
            island,
            island, // 2 U sources — fully covers demand
            greenFiller, // 1 G pip demand
            forest, // 1 G source — fully covers demand
        ];
        const volcanicFixing = termValue(
            scoreCandidate(volcanicIsland, temurPool, null),
            "fixingValue"
        );
        const tropicalFixing = termValue(
            scoreCandidate(tropicalIsland, temurPool, null),
            "fixingValue"
        );
        expect(volcanicFixing).toBeGreaterThan(tropicalFixing);
        // Rejected alternative check (ADR 0073's "Considered Options"):
        // commitment-driven fixing would reward the colour ALREADY served —
        // U here, served equally by both duals — never distinguishing them
        // the way the deficit-driven formula does.
        expect(tropicalFixing).toBe(0);
    });
});

describe("Pick Invariant — the rating anchors the score (ADR 0073)", () => {
    it("raising a candidate's rating may not LOWER its score, at any Pool depth", () => {
        for (const depth of POOL_DEPTHS) {
            const pool = Array(depth).fill(greenFiller) as CardEvalMeta[];
            let previous = -Infinity;
            for (
                let rating = PICK_RATING_MIN;
                rating <= PICK_RATING_MAX;
                rating += 0.5
            ) {
                const score = scoreCandidate(redThreeDrop, pool, rating).score;
                expect(score).toBeGreaterThanOrEqual(previous - 1e-12);
                previous = score;
            }
        }
    });

    it("no contextual context can overturn the full rating spread", () => {
        // The most hostile arrangement the current term set allows: the LOW-
        // rated card is deep on-colour and fills an empty bucket, the HIGH-
        // rated one shares no colour with the Pool and sits in a saturated
        // bucket. Holds for any weighting because the contextual sum is capped
        // below the rating spread (asserted above).
        const pool = [
            ...Array(20).fill(greenFiller),
            ...Array(8).fill({ ...greenFiller, manaValue: 3 }),
        ] as CardEvalMeta[];
        const favouredLowRated = { ...greenTwoDrop, manaValue: 5 };
        const disfavouredHighRated = { ...redThreeDrop, manaValue: 3 };
        expect(
            scoreCandidate(disfavouredHighRated, pool, PICK_RATING_MAX).score
        ).toBeGreaterThan(
            scoreCandidate(favouredLowRated, pool, PICK_RATING_MIN).score
        );
    });

    it("the unrated fallback is strictly increasing in quality and stays inside the rating scale", () => {
        let previous = -Infinity;
        for (const quality of [0, 1, 8, 50, 100, 250, 500, 1000, 100000]) {
            const rating = heuristicAsRating(quality);
            expect(rating).toBeGreaterThanOrEqual(PICK_RATING_MIN);
            expect(rating).toBeLessThanOrEqual(PICK_RATING_MAX);
            expect(rating).toBeGreaterThanOrEqual(previous);
            previous = rating;
        }
        // Real cards, real ordering: a strictly bigger body maps strictly
        // higher, so no quality ordering was lost by moving onto the scale.
        expect(candidateQuality(greenFiveDrop)).toBeGreaterThan(
            candidateQuality(greenTwoDrop)
        );
        expect(
            heuristicAsRating(candidateQuality(greenFiveDrop))
        ).toBeGreaterThan(heuristicAsRating(candidateQuality(greenTwoDrop)));
    });
});

describe("Pick Invariant — determinism and the unread packsSeen (ADR 0073)", () => {
    const metaTable: Record<string, CardEvalMeta> = {
        green2: greenTwoDrop,
        green5: greenFiveDrop,
        red3: redThreeDrop,
    };
    const getCardEvalMeta: GetCardEvalMeta = (id) => metaTable[id] ?? null;
    const pack: DraftPackCard[] = Object.keys(metaTable).map((id, i) => ({
        scryfallId: id,
        cardId: id,
        cardName: id,
        pickId: `pick-${i}`,
    }));

    it("the same inputs always produce the identical trace (no RNG, no clock)", () => {
        const pool = [greenFiller, redFiller];
        expect(scoreCandidate(greenTwoDrop, pool, 3)).toEqual(
            scoreCandidate(greenTwoDrop, pool, 3)
        );
        expect(
            scorePack(pack, pool, getCardEvalMeta, { packsSeen: [pack] })
        ).toEqual(
            scorePack(pack, pool, getCardEvalMeta, { packsSeen: [pack] })
        );
    });

    it("packsSeen is UNREAD: any history — empty, one pack, many — yields the same pick", () => {
        const picks = [
            chooseBotPick(pack, [], getCardEvalMeta, { packsSeen: [] }),
            chooseBotPick(pack, [], getCardEvalMeta, { packsSeen: [pack] }),
            chooseBotPick(pack, [], getCardEvalMeta, {
                packsSeen: [pack, pack, [pack[0]]],
            }),
        ];
        expect(new Set(picks).size).toBe(1);
    });

    it("chooseBotPick agrees with the traces it scored — one arithmetic path, not two", () => {
        const options = { packsSeen: [pack], getPickRating: () => null };
        const traces = scorePack(pack, [], getCardEvalMeta, options);
        const best = traces.reduce(
            (bestIdx, trace, i) =>
                (trace?.score ?? -Infinity) >
                (traces[bestIdx]?.score ?? -Infinity)
                    ? i
                    : bestIdx,
            0
        );
        expect(chooseBotPick(pack, [], getCardEvalMeta, options)).toBe(
            pack[best].pickId
        );
    });
});
