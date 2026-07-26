// Pick Invariants (PRD #1607, ADR 0073, issue #1609) — the FIRST batch.
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
//   * the score is exactly the sum of its breakdown, and every contextual term
//     lives under the pick's contextual cap
//   * `packsSeen` is unread, so supplying it may not change any pick
//
// Every one of these holds for ANY positive weighting: retuning
// `COLOUR_COMMIT_RATING_PER_CARD`, the curve weight, the cap endpoints or the
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
import { getCardColorIdentity } from "../../cards/colors";
import { manaValue } from "../../gre/constants";
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
    sumTraceTerms,
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
        ...over,
    };
}

/** Green 2-drop / green 5-drop / red 3-drop reference cards. Real registry
 *  cards (so the quality fallback resolves), with the field under test
 *  overridden — the same isolation discipline `botDrafter.bot.test.ts` uses. */
const greenTwoDrop = metaOf("Grizzly Bears", { colors: ["G"], manaValue: 2 });
const greenFiveDrop = metaOf("Craw Wurm", { colors: ["G"], manaValue: 5 });
const redThreeDrop = metaOf("Hill Giant", { colors: ["R"], manaValue: 3 });
/** Curve-neutral filler (mana value 0), so adding it to a Pool moves the
 *  colour signal WITHOUT touching the curve signal. */
const greenFiller = metaOf("Grizzly Bears", { colors: ["G"], manaValue: 0 });
const redFiller = metaOf("Hill Giant", { colors: ["R"], manaValue: 0 });

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
                    expect(trace.score).toBeCloseTo(
                        sumTraceTerms(trace.terms),
                        12
                    );
                }
            }
        }
    });

    it("the sum of every contextual term stays within the pick's contextual cap", () => {
        for (const depth of POOL_DEPTHS) {
            // A mixed Pool so both contextual terms are genuinely non-zero.
            const pool = [
                ...Array(depth).fill(greenTwoDrop),
                ...Array(depth).fill(redFiller),
            ] as CardEvalMeta[];
            for (const candidate of [
                greenTwoDrop,
                greenFiveDrop,
                redThreeDrop,
            ]) {
                const trace = scoreCandidate(candidate, pool, 3);
                const contextual = trace.terms
                    .filter((t) => isContextualTerm(t.term))
                    .reduce((sum, t) => sum + t.value, 0);
                expect(Math.abs(contextual)).toBeLessThanOrEqual(
                    trace.contextCap + 1e-9
                );
            }
        }
    });

    it("a term's provenance only ever names cards that are actually in the Pool", () => {
        const pool = [greenTwoDrop, greenFiller, redFiller];
        const poolIds = new Set(pool.map((c) => c.cardId));
        for (const candidate of [greenTwoDrop, redThreeDrop]) {
            for (const term of scoreCandidate(candidate, pool, null).terms) {
                for (const source of term.sources) {
                    expect(poolIds.has(source.cardId)).toBe(true);
                    expect(source.reason.length).toBeGreaterThan(0);
                }
            }
        }
    });

    it("a non-zero contextual term always names at least one responsible Pool card", () => {
        const pool = Array(6).fill(greenTwoDrop) as CardEvalMeta[];
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
                scoreCandidate({ ...greenTwoDrop, colors: ["R"] }, pool, 3),
                "colourCommitment"
            );
            expect(onColour).toBeGreaterThanOrEqual(offColour - 1e-12);
        }
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
