// Bot Drafter Pick Heuristic tests (PRD #1107 story 29, ADR 0054, issue
// #1113). Mirrors `draftEngine.test.ts`'s discipline: pure functions,
// deterministic, no convex-test harness needed. `scoreCandidate` reads real
// card quality through the shared `cardValueById` (`convex/gre/cardValue.ts`)
// against the actual LEA registry, so quality-ordering assertions use real
// LEA cards; color/curve assertions hold `cardId` FIXED across a synthetic
// `CardEvalMeta` so only the field under test varies — isolating each term
// from the others' contribution.
import { describe, it, expect } from "vitest";
import {
    getCardByName,
    resolveDeckCardMeta,
    tryGetDefinition,
} from "../../cards";
import { getCardColorIdentity, getPipCountsFromCost } from "../../cards/colors";
import type { Color } from "../../cards/types";
import { getDefinitionProducibleColors, manaValue } from "../../gre/constants";
import {
    CONTEXT_CAP_LAST_PICK,
    chooseBotPick,
    contextCapForPick,
    scoreCandidate,
    type CardEvalMeta,
    type GetCardEvalMeta,
    type GetPickRating,
    type PickTermKey,
} from "../botDrafter";
import {
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
} from "../draftEngine";
import {
    buildEmptySeats,
    fillBotSeats,
    type ResolveCardMeta,
} from "../eventLogic";
import type { DraftPackCard, LimitedPoolCard } from "../eventTypes";
import { getPickRatingByCardId } from "../pickRatings";
import { getBoosterConfig } from "../registry";

/** Builds a real `CardEvalMeta` from a LEA card name — the card-quality
 *  fixtures below (`scoreCandidate` reads `cardValueById` off `cardId`,
 *  which only resolves against the real registry). */
function metaOf(name: string): CardEvalMeta {
    const def = getCardByName(name);
    return {
        cardId: def.id,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: def.rarity,
        pips: getPipCountsFromCost(def.manaCost),
        producedColors: [...getDefinitionProducibleColors(def)],
    };
}

/** `chooseBotPick` with ADR 0073's required options object. `packsSeen` is the
 *  pack being picked from — the only history a unit test can honestly account
 *  for, and unread by the scorer today (Draft Signals is a later slice). */
function pickFrom(
    pack: readonly DraftPackCard[],
    pool: readonly LimitedPoolCard[],
    getCardEvalMeta: GetCardEvalMeta,
    getPickRating?: GetPickRating
): string {
    return chooseBotPick(pack, pool, getCardEvalMeta, {
        packsSeen: [pack],
        getPickRating,
    });
}

/** `scoreCandidate`'s derived total (ADR 0073: the trace IS the result, the
 *  score is the sum of its breakdown) — the number every ordering assertion
 *  below compares. */
function scoreOf(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[],
    rating: number | null = null
): number {
    return scoreCandidate(candidate, poolMeta, rating).score;
}

/** One named term out of a candidate's breakdown. */
function termOf(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[],
    term: PickTermKey,
    rating: number | null = null
) {
    const found = scoreCandidate(candidate, poolMeta, rating).terms.find(
        (t) => t.term === term
    );
    if (!found) throw new Error(`no ${term} term in trace`);
    return found;
}

// Grizzly Bears (G, 2/2 vanilla) — the fixed "quality anchor" used to
// isolate the color/curve terms: overriding `colors`/`manaValue` on a COPY of
// this fixture changes only what those terms read, never the quality term
// (`scoreCandidate` derives quality from `cardId` alone).
const bears = metaOf("Grizzly Bears");
// Craw Wurm (4G, 6/4 vanilla) — strictly bigger body, same color/rarity as
// Grizzly Bears: a real, higher latent-`cardValueById` green common.
const wurm = metaOf("Craw Wurm");
// Hill Giant (3R, 3/3 vanilla) — an off-color (red) reference card.
const hillGiant = metaOf("Hill Giant");

describe("scoreCandidate — card quality (PRD #1107 story 29: 'prefers higher-quality card at equal color fit')", () => {
    it("prefers the bigger body at equal color, rarity and empty pool", () => {
        expect(scoreOf(wurm, [])).toBeGreaterThan(scoreOf(bears, []));
    });

    it("a higher rarity outscores the same body at a lower rarity", () => {
        const common: CardEvalMeta = { ...bears, rarity: "common" };
        const mythic: CardEvalMeta = { ...bears, rarity: "mythic" };
        expect(scoreOf(mythic, [])).toBeGreaterThan(scoreOf(common, []));
    });

    it("an unrated card's quality lands ON the rating scale, so it is comparable with a rated one (ADR 0073 heuristicAsRating)", () => {
        const base = termOf(wurm, [], "baseRating");
        expect(base.value).toBeGreaterThan(0);
        expect(base.value).toBeLessThanOrEqual(5);
        expect(base.note).toContain("unrated");
        // ... and a real rating simply replaces it, on the same scale.
        expect(termOf(wurm, [], "baseRating", 4.25).value).toBe(4.25);
    });
});

describe("scoreCandidate — color commitment (PRD #1107 story 29: 'prefers on-color over off-color as commitment grows')", () => {
    it("does not penalize an off-color pick within the grace window (few picks so far)", () => {
        // cardId fixed (bears) so the base term is identical; only `colors`
        // differs. Assert on the TERM rather than the total: the contextual cap
        // itself grows with the pool (ADR 0073), so two totals taken at
        // different pool sizes are not comparable by construction.
        const green: CardEvalMeta = { ...bears, colors: ["G"], manaValue: 0 };
        const red: CardEvalMeta = {
            ...bears,
            colors: ["R"],
            pips: { R: 1 },
        };
        const smallGreenPool = [green, green]; // 2 picks — within the grace window

        expect(termOf(red, smallGreenPool, "colourCommitment").rawValue).toBe(
            0
        );
    });

    it("the on-color/off-color preference strictly grows as the pool commits deeper into a color", () => {
        const green: CardEvalMeta = { ...bears, colors: ["G"] };
        const red: CardEvalMeta = {
            ...bears,
            colors: ["R"],
            pips: { R: 1 },
        };

        const shallowPool = Array(4).fill(green); // just past the grace window
        const deepPool = Array(10).fill(green); // heavily committed to green

        const shallowGap =
            scoreOf(green, shallowPool) - scoreOf(red, shallowPool);
        const deepGap = scoreOf(green, deepPool) - scoreOf(red, deepPool);

        expect(deepGap).toBeGreaterThan(shallowGap);
        // And the on-color candidate is preferred outright once committed.
        expect(scoreOf(green, deepPool)).toBeGreaterThan(
            scoreOf(red, deepPool)
        );
    });

    it("a colorless candidate is neutral to color commitment either way", () => {
        const colorless: CardEvalMeta = { ...bears, colors: [], pips: {} };
        const green: CardEvalMeta = { ...bears, colors: ["G"], manaValue: 0 };
        const deepGreenPool = Array(10).fill(green);
        expect(
            termOf(colorless, deepGreenPool, "colourCommitment").rawValue
        ).toBe(0);
        expect(termOf(colorless, [], "colourCommitment").rawValue).toBe(0);
    });

    it("names the specific Pool cards behind the term (ADR 0073 provenance)", () => {
        const green: CardEvalMeta = { ...bears, colors: ["G"], manaValue: 0 };
        const otherGreen: CardEvalMeta = { ...wurm, colors: ["G"] };
        const term = termOf(
            { ...bears, colors: ["G"] },
            [green, otherGreen],
            "colourCommitment"
        );
        expect(term.sources.map((s) => s.cardId).sort()).toEqual(
            [green.cardId, otherGreen.cardId].sort()
        );
        for (const source of term.sources) {
            expect(source.reason).toContain("{G}");
        }
    });
});

describe("scoreCandidate — curve gaps (PRD #1107 story 29: 'fills curve gaps')", () => {
    it("prefers filling an empty curve bucket over topping up an already-satisfied one", () => {
        // cardId fixed (bears) so quality is identical; only `manaValue` differs.
        const twoDrop: CardEvalMeta = { ...bears, manaValue: 2 }; // target bucket count: 5
        const fiveDrop: CardEvalMeta = { ...bears, manaValue: 5 }; // target bucket count: 3

        // Pool already has 5 two-drops (bucket fully satisfied) but no
        // five-drops at all (bucket empty).
        const pool = Array(5).fill({ ...bears, manaValue: 2 });

        expect(scoreOf(fiveDrop, pool)).toBeGreaterThan(scoreOf(twoDrop, pool));
    });

    it("a 0-mana-value card (e.g. a land) never earns a curve bonus", () => {
        const land: CardEvalMeta = {
            ...bears,
            manaValue: 0,
            colors: [],
            pips: {},
        };
        expect(termOf(land, [], "curveFit").rawValue).toBe(0);
        expect(termOf(land, [land], "curveFit").rawValue).toBe(0);
    });
});

describe("scoreCandidate — the breakdown IS the score (ADR 0073)", () => {
    const pool = [
        { ...bears, colors: ["G"] as const },
        { ...wurm, manaValue: 6 },
    ] as CardEvalMeta[];

    it("the score is exactly the sum of the breakdown — no second arithmetic path", () => {
        for (const rating of [null, 0, 2.5, 5]) {
            const trace = scoreCandidate(bears, pool, rating);
            // Summed INLINE, deliberately not via the SUT's own
            // `sumTraceTerms`: `trace.score` is literally assigned that call,
            // so checking one against the other is a tautology. An independent
            // sum here is what would catch a future second arithmetic path.
            const summed = trace.terms.reduce((s, t) => s + t.value, 0);
            expect(trace.score).toBeCloseTo(summed, 12);
        }
    });

    it("every contextual term is scaled by ONE factor, so the capped sum stays the sum of the terms", () => {
        const trace = scoreCandidate(bears, pool, 3);
        const contextual = trace.terms.filter((t) => t.term !== "baseRating");
        expect(contextual.length).toBeGreaterThan(0);
        for (const term of contextual) {
            expect(term.value).toBeCloseTo(
                term.rawValue * trace.contextScale,
                12
            );
        }
        const contextTotal = contextual.reduce((s, t) => s + t.value, 0);
        expect(Math.abs(contextTotal)).toBeLessThanOrEqual(
            trace.contextCap + 1e-9
        );
        expect(trace.contextCap).toBeLessThanOrEqual(CONTEXT_CAP_LAST_PICK);
    });
});

describe("chooseBotPick (PRD #1107 stories 8, 9, 27)", () => {
    const metaTable: Record<string, CardEvalMeta> = {
        bears: bears,
        wurm: wurm,
        giant: hillGiant,
    };
    const getCardEvalMeta: GetCardEvalMeta = (scryfallId) =>
        metaTable[scryfallId] ?? null;

    function packCard(scryfallId: string, pickId: string): DraftPackCard {
        return { scryfallId, cardId: scryfallId, cardName: scryfallId, pickId };
    }

    it("picks the highest-scoring card in the pack", () => {
        const pack = [
            packCard("bears", "pick-bears"),
            packCard("wurm", "pick-wurm"),
            packCard("giant", "pick-giant"),
        ];
        // Empty pool: wurm strictly outscores bears (bigger body, same
        // color/rarity) and giant is off-color-neutral (empty pool, no
        // penalty yet) but a smaller body than wurm.
        expect(pickFrom(pack, [], getCardEvalMeta)).toBe("pick-wurm");
    });

    it("is deterministic: the same pack + pool always yields the same pick", () => {
        const pack = [
            packCard("bears", "pick-bears"),
            packCard("wurm", "pick-wurm"),
        ];
        const pool: LimitedPoolCard[] = [];
        const first = pickFrom(pack, pool, getCardEvalMeta);
        const second = pickFrom(pack, pool, getCardEvalMeta);
        expect(first).toBe(second);
    });

    it("ties break by pack position (first wins)", () => {
        const pack = [packCard("bears", "pick-a"), packCard("bears", "pick-b")];
        expect(pickFrom(pack, [], getCardEvalMeta)).toBe("pick-a");
    });

    it("never crashes on an unresolvable candidate — ranks it lowest instead", () => {
        const pack = [
            packCard("unknown-card", "pick-unknown"),
            packCard("bears", "pick-bears"),
        ];
        expect(pickFrom(pack, [], getCardEvalMeta)).toBe("pick-bears");
    });

    it("throws when the pack is empty (same contract as applyPick's own guard)", () => {
        expect(() => pickFrom([], [], getCardEvalMeta)).toThrow(
            /pack is empty/
        );
    });
});

describe("scripted 8-seat all-bot draft — plausibly coherent 2-color pools (PRD #1107 story 29 acceptance)", () => {
    // Real registry wiring — the same shape `convex/limitedEvents.ts` uses.
    const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
        const def = tryGetDefinition(scryfallId);
        if (!def) return null;
        const meta = resolveDeckCardMeta(scryfallId);
        return meta ? { cardId: meta.cardId, cardName: def.name } : null;
    };
    const realGetCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
        const meta = resolveDeckCardMeta(scryfallId);
        if (!meta) return null;
        const def = tryGetDefinition(meta.cardId);
        if (!def) return null;
        return {
            cardId: meta.cardId,
            colors: getCardColorIdentity(def),
            manaValue: manaValue(def.manaCost),
            rarity: meta.rarity,
            pips: getPipCountsFromCost(def.manaCost),
            producedColors: [...getDefinitionProducibleColors(def)],
        };
    };
    const realBotChoosePick: ChooseBotPick = (seat, pack) =>
        pickFrom(pack, seat.pool ?? [], realGetCardEvalMeta);

    it("every bot seat's finished pool concentrates in (at most) two colors", () => {
        const packSlots = ["lea", "lea", "lea"];
        const seats = fillBotSeats(buildEmptySeats(8));
        const seed = 20260714;
        const dealt = startDraft(
            seats,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta
        );
        const result = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            realBotChoosePick
        );

        expect(result.completed).toBe(true);
        for (const seat of result.seats) {
            expect(seat.pool).toHaveLength(15 * packSlots.length);

            const colorCounts: Partial<Record<Color, number>> = {};
            let coloredCount = 0;
            for (const card of seat.pool!) {
                const meta = realGetCardEvalMeta(card.scryfallId);
                if (!meta) continue;
                for (const c of meta.colors) {
                    colorCounts[c] = (colorCounts[c] ?? 0) + 1;
                    coloredCount += 1;
                }
            }
            const sortedCounts = Object.values(colorCounts).sort(
                (a, b) => b - a
            );
            const topTwo = sortedCounts.slice(0, 2).reduce((s, n) => s + n, 0);

            // The heuristic's color-commitment term should concentrate each
            // bot's colored picks into its top two colors — "plausibly
            // coherent 2-color pools", not a spread across all five.
            //
            // Threshold lowered 0.6 → 0.5 by issue #1610 (pip-weighted
            // Colour Commitment + Castability + Fixing Value, ADR 0073).
            // MEASURED against this exact seed (worst seat / mean-of-8, via
            // `chooseBotPick` scoring): pre-#1610 (checked-in commit
            // 9b60e197) 0.609 / 0.781 → post-#1610 (this PR) 0.545 / 0.740.
            //
            // Root-caused (fixup review, issue #1610 receipt) by running the
            // identical scripted draft with individual terms re-scored to 0
            // (the clamp math redone from the remaining terms, so the
            // ablation is faithful to the real cap/scale, not just a raw
            // subtraction):
            //   - minus Fixing Value alone: 0.523 / 0.624 — WORSE than the
            //     shipped 0.545 / 0.740, not better. Fixing Value's deficit-
            //     driven design targets the colour a seat is ALREADY short
            //     on, so it reinforces concentration on net; it is not the
            //     driver the term's own on-colour-vs-off-colour worked
            //     example would suggest.
            //   - minus Castability alone: 0.591 / 0.743 — a small worst-seat
            //     recovery, roughly flat mean.
            //   - zeroing `COLOUR_COMMIT_SOURCE_UNIT_WEIGHT` alone (a mana
            //     source no longer contributes ANY colour affinity): 0.578 /
            //     0.749 — the single largest recovery of any one lever, but
            //     still short of the 0.609 / 0.781 baseline.
            //   - no single-term ablation, nor the two combined, fully
            //     restores the baseline.
            // Conclusion: the regression is not one runaway term, it is
            // STRUCTURAL. Every contextual term shares ONE capped budget
            // (`contextCap`, `scoreCandidate`'s `contextScale`) — going from
            // 2 contextual terms (Colour Commitment, Curve Fit) to 4 (adding
            // Castability, Fixing Value) raises how often that shared sum
            // exceeds the cap, which scales down EVERY contextual term
            // together, Colour Commitment included, on the very picks where
            // Castability/Fixing Value are also large. That dilution is a
            // direct, intended consequence of ADR 0073's design ("fixing and
            // castability legitimately matter now too, not only raw colour
            // commitment") — not a bug to null out, since doing so would mean
            // neutering Castability's genuine splash/colourless signal or
            // zeroing the source-follows-commitment weight, both of which
            // issue #1610 shipped on purpose. "Plausibly coherent", not
            // "strictly 2-colour", remains the bar; 0.545 still comfortably
            // beats an unconcentrated spread across all five colours (~0.4
            // for the top two), so 0.5 is kept as the threshold rather than
            // restoring 0.6.
            expect(coloredCount).toBeGreaterThan(0);
            expect(topTwo / coloredCount).toBeGreaterThan(0.5);
        }
    });
});

// --- Pick Rating layer (issue #1117, ADR 0054/0055) -------------------------

describe("scoreCandidate's rating layer (issue #1117 acceptance: 'scoring layers verified'; recomposed by ADR 0073)", () => {
    it("a null rating falls back to the quality heuristic mapped onto the SAME scale", () => {
        const unrated = termOf(wurm, [], "baseRating");
        expect(unrated.note).toContain("unrated");
        // The fallback is a CHAIN, not a sum: a real rating replaces the
        // heuristic outright (ADR 0073).
        expect(termOf(wurm, [], "baseRating", 3).value).toBe(3);
    });

    it("a rated card beats a heuristically-favored lower-rated card (the rating anchors the score)", () => {
        // Craw Wurm strictly outscores Grizzly Bears on quality alone (bigger
        // body, same color/rarity, empty pool) — see the "card quality"
        // describe block above. A low rating on the wurm and a high rating on
        // the bears must flip that ordering.
        expect(scoreOf(wurm, [])).toBeGreaterThan(scoreOf(bears, []));
        expect(scoreOf(bears, [], 5)).toBeGreaterThan(scoreOf(wurm, [], 1));
    });

    it("a rating gap WIDER THAN THE PICK'S CONTEXTUAL CAP survives any contextual context", () => {
        // The guarantee the cap actually provides (ADR 0073, refined by the
        // #1609 review): every candidate's contextual sum is clamped to
        // `[0, contextCapForPick]`, so context can move two candidates apart by
        // at most the cap — never `2 × cap`, which is what the old symmetric
        // `±cap` clamp allowed. A gap wider than the cap is therefore
        // untouchable; a gap NARROWER than it is legitimately overturnable, and
        // the sibling test below pins that down.
        const green: CardEvalMeta = { ...bears, colors: ["G"], manaValue: 2 };
        const pool = Array(20).fill(green) as CardEvalMeta[];
        const favouredButBad: CardEvalMeta = {
            ...bears,
            colors: ["G"],
            manaValue: 5,
        };
        const disfavouredButGood: CardEvalMeta = {
            ...bears,
            colors: ["R"],
            pips: { R: 1 },
        };
        // 4 rating points against a pick-21 cap of ~1.45 — comfortably wider.
        expect(contextCapForPick(pool.length + 1)).toBeLessThan(4);
        expect(scoreOf(disfavouredButGood, pool, 5)).toBeGreaterThan(
            scoreOf(favouredButBad, pool, 1)
        );
    });

    it("a rating gap NARROWER than the pick's cap is overturnable — the cap is the licence, not a veto", () => {
        // The other half of the same guarantee, and the reviewer's repro
        // (issue #1609): a deep on-colour pool, a 3.0-rated on-colour 2-drop
        // against a 4.0-rated off-colour card. The 1-point gap is inside the
        // pick-41 cap (~1.92), so context IS allowed to overturn it — what the
        // old clamp got wrong was licensing an overturn of up to 2 × cap.
        const onColourFiller: CardEvalMeta = {
            ...bears,
            colors: ["G"],
            manaValue: 0,
        };
        const pool = Array(40).fill(onColourFiller) as CardEvalMeta[];
        const cap = contextCapForPick(pool.length + 1);
        const onColourTwoDrop: CardEvalMeta = {
            ...bears,
            colors: ["G"],
            manaValue: 2,
        };
        const offColour: CardEvalMeta = {
            ...bears,
            colors: ["R"],
            pips: { R: 1 },
            manaValue: 0,
        };

        expect(scoreOf(onColourTwoDrop, pool, 3)).toBeGreaterThan(
            scoreOf(offColour, pool, 4)
        );
        // ... but only by at most the cap: the off-colour card is not
        // PENALISED, it simply earns no contextual bonus.
        expect(scoreOf(offColour, pool, 4)).toBe(4);
        expect(
            scoreOf(onColourTwoDrop, pool, 3) - scoreOf(offColour, pool, 4)
        ).toBeLessThanOrEqual(cap - 1 + 1e-9);
        // One more rating point (a gap wider than the cap) flips it back.
        expect(scoreOf(offColour, pool, 5)).toBeGreaterThan(
            scoreOf(onColourTwoDrop, pool, 3)
        );
    });

    it("two equally-rated candidates share their base term, and only context separates them (ADR 0073's fallback chain)", () => {
        expect(termOf(wurm, [], "baseRating", 3).value).toBe(
            termOf(bears, [], "baseRating", 3).value
        );
        // Same rating, same (empty) context, same mana value → an exact tie,
        // broken downstream by pack position. Raw quality no longer refines a
        // rated pair; the contextual terms do.
        expect(scoreOf(wurm, [], 3)).toBe(
            scoreOf({ ...bears, manaValue: wurm.manaValue }, [], 3)
        );
    });
});

describe("chooseBotPick — the pick number counts the WHOLE Pool (issue #1609 review)", () => {
    // `chooseBotPick` drops Pool cards the registry can't resolve before
    // scoring, but an unresolvable card is still a pick the seat made. If the
    // pick number were derived from the FILTERED Pool, the filter and the
    // derivation would disagree and the seat would be handed an earlier pick's
    // (smaller) contextual cap.
    const mv0 = "mv0";
    const mv2 = "mv2";
    const metaTable: Record<string, CardEvalMeta> = {
        // Colourless, mana value 0: earns NO contextual bonus at all.
        // Distinct `cardId`s so the rating lookup can tell them apart.
        [mv0]: { ...hillGiant, colors: [], pips: {}, manaValue: 0 },
        // Colourless 2-drop into an empty curve: earns the full curve bonus,
        // which the cap then clamps — so this candidate's score, and only
        // this candidate's, moves with the pick number.
        [mv2]: { ...bears, colors: [], pips: {}, manaValue: 2 },
    };
    const getCardEvalMeta: GetCardEvalMeta = (id) => metaTable[id] ?? null;
    const pack: DraftPackCard[] = [mv0, mv2].map((id) => ({
        scryfallId: id,
        cardId: id,
        cardName: id,
        pickId: `pick-${id}`,
    }));
    // A rating gap the FIRST pick's cap cannot close but a late pick's can.
    const getPickRating: GetPickRating = (cardId) =>
        cardId === metaTable[mv0].cardId ? 4.9 : 4.5;

    function poolOf(scryfallId: string, n: number): LimitedPoolCard[] {
        return Array.from({ length: n }, () => ({
            scryfallId,
            cardId: scryfallId,
            cardName: scryfallId,
        }));
    }

    it("an EMPTY Pool is pick 1: the tiny first-pick cap can't close a 0.4 rating gap", () => {
        expect(pickFrom(pack, [], getCardEvalMeta, getPickRating)).toBe(
            "pick-mv0"
        );
    });

    it("40 UNRESOLVABLE Pool cards still advance the pick number, so the late cap applies", () => {
        // Every Pool entry resolves to `null`, so the scored `poolMeta` is
        // empty in BOTH cases and the contextual TERMS are identical — the
        // only thing that can differ is the cap, i.e. the pick number.
        const unresolvable = poolOf("not-in-registry", 40);
        expect(getCardEvalMeta("not-in-registry")).toBeNull();
        expect(
            pickFrom(pack, unresolvable, getCardEvalMeta, getPickRating)
        ).toBe("pick-mv2");
    });

    it("an explicit options.pickNumber overrides the derivation", () => {
        expect(
            chooseBotPick(pack, [], getCardEvalMeta, {
                packsSeen: [pack],
                getPickRating,
                pickNumber: 41,
            })
        ).toBe("pick-mv2");
    });
});

describe("chooseBotPick with the Pick Rating layer (issue #1117)", () => {
    const metaTable: Record<string, CardEvalMeta> = {
        bears,
        wurm,
        giant: hillGiant,
    };
    const getCardEvalMeta: GetCardEvalMeta = (scryfallId) =>
        metaTable[scryfallId] ?? null;

    function packCard(scryfallId: string, pickId: string): DraftPackCard {
        return { scryfallId, cardId: scryfallId, cardName: scryfallId, pickId };
    }

    it("a rated card beats the heuristic's own favorite when a Pick Rating is supplied", () => {
        const pack = [
            packCard("bears", "pick-bears"),
            packCard("wurm", "pick-wurm"),
        ];
        // Without ratings, the heuristic alone prefers the wurm (bigger body).
        expect(pickFrom(pack, [], getCardEvalMeta)).toBe("pick-wurm");

        // With bears rated a 5 (and wurm unrated), the rating dominates.
        // `getPickRating` is keyed on the candidate's CANONICAL `cardId`
        // (`CardEvalMeta.cardId`), not the pack's `scryfallId` — `bears`'s
        // fixture carries the real Grizzly Bears definition id.
        const getPickRating: GetPickRating = (cardId) =>
            cardId === bears.cardId ? 5 : null;
        expect(pickFrom(pack, [], getCardEvalMeta, getPickRating)).toBe(
            "pick-bears"
        );
    });

    it("unrated cards fall back to the heuristic even when getPickRating is supplied", () => {
        const pack = [
            packCard("bears", "pick-bears"),
            packCard("wurm", "pick-wurm"),
            packCard("giant", "pick-giant"),
        ];
        const getPickRating: GetPickRating = () => null; // nothing rated
        expect(pickFrom(pack, [], getCardEvalMeta, getPickRating)).toBe(
            pickFrom(pack, [], getCardEvalMeta)
        );
    });

    it("omitting getPickRating reproduces the EXACT pre-Pick-Rating-layer pick — the real production lookup, on cards no checked-in file rates, agrees (regression: a set without ratings drafts exactly as before)", () => {
        const pack = [
            packCard("bears", "pick-bears"),
            packCard("wurm", "pick-wurm"),
        ];
        const withoutRatingArg = pickFrom(pack, [], getCardEvalMeta);
        // These synthetic ids ("bears"/"wurm") are not real LEA card ids, so
        // the REAL production `getPickRatingByCardId` (which only rates real
        // checked-in cardIds) returns null for all of them — exactly the "no
        // ratings file for this set" case.
        const withRealLookup = pickFrom(
            pack,
            [],
            getCardEvalMeta,
            getPickRatingByCardId
        );
        expect(withRealLookup).toBe(withoutRatingArg);
        expect(withRealLookup).toBe("pick-wurm");
    });
});

describe("scripted all-bot LEA draft — bots take obvious bombs first-pick (issue #1117 acceptance: deterministic seeded test)", () => {
    // Same real-registry wiring as the "plausibly coherent 2-color pools"
    // draft above, plus the real Pick Rating lookup.
    const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
        const def = tryGetDefinition(scryfallId);
        if (!def) return null;
        const meta = resolveDeckCardMeta(scryfallId);
        return meta ? { cardId: meta.cardId, cardName: def.name } : null;
    };
    const realGetCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
        const meta = resolveDeckCardMeta(scryfallId);
        if (!meta) return null;
        const def = tryGetDefinition(meta.cardId);
        if (!def) return null;
        return {
            cardId: meta.cardId,
            colors: getCardColorIdentity(def),
            manaValue: manaValue(def.manaCost),
            rarity: meta.rarity,
            pips: getPipCountsFromCost(def.manaCost),
            producedColors: [...getDefinitionProducibleColors(def)],
        };
    };
    const realBotChoosePickRated: ChooseBotPick = (seat, pack) =>
        pickFrom(
            pack,
            seat.pool ?? [],
            realGetCardEvalMeta,
            getPickRatingByCardId
        );

    // A rating this close to `PICK_RATING_MAX` (5.0) sits above anything the
    // quality fallback can reach for an UNRATED LEA card (`heuristicAsRating`
    // tops out near 4.0 on this set's biggest body) plus the FIRST pick's
    // contextual cap (~0.3 rating points, ADR 0073) — the "obvious bomb" bar.
    // A MID-tier rating (e.g. 2.0-3.0, "solid playable") is deliberately NOT
    // asserted here: it nudges the heuristic rather than overriding it, so it
    // can still lose to an unrated card the heuristic loves — exactly the
    // "ratings REFINE, never GATE" design (ADR 0054/0055), not a bug.
    const OBVIOUS_BOMB_THRESHOLD = 4.5;

    it("every bot seat with an obvious bomb (rating >= 4.5) in its P1P1 pack takes it, even against strong heuristic-favored alternatives", () => {
        const packSlots = ["lea", "lea", "lea"];
        const seed = 20260714; // same seed the 2-color-pools test above uses
        const seats = fillBotSeats(buildEmptySeats(8));
        const dealt = startDraft(
            seats,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta
        );

        let sawAtLeastOneObviousBomb = false;
        for (const seat of dealt.seats) {
            const pack = seat.currentPack!;
            const bombs = pack
                .map((c) => {
                    const meta = realGetCardEvalMeta(c.scryfallId);
                    if (!meta) return null;
                    const rating = getPickRatingByCardId(meta.cardId);
                    return rating !== null && rating >= OBVIOUS_BOMB_THRESHOLD
                        ? { pickId: c.pickId, cardName: c.cardName }
                        : null;
                })
                .filter(
                    (b): b is { pickId: string; cardName: string } => b !== null
                );
            if (bombs.length === 0) continue;

            // At most one obvious bomb per pack given this curated file and
            // seed — assert it deterministically, rather than assuming it,
            // so a future curation change that breaks the assumption fails
            // loudly here instead of silently passing a vacuous check.
            expect(bombs).toHaveLength(1);
            sawAtLeastOneObviousBomb = true;
            const picked = realBotChoosePickRated(seat, pack, [pack]);
            expect(picked).toBe(bombs[0].pickId);
        }

        // Across 8 seats' opening packs (120 cards from a 291-card set with
        // several cards rated 4.5+), at least one obvious bomb should show
        // up given this fixed seed — a vacuous pass (nothing bomb-tier ever
        // dealt) would prove nothing about "bots take obvious bombs
        // first-pick".
        expect(sawAtLeastOneObviousBomb).toBe(true);
    });

    it("is fully deterministic: re-running the same seed yields the same picks", () => {
        const packSlots = ["lea", "lea", "lea"];
        const seed = 20260714;

        function firstPicks(): string[] {
            const seats = fillBotSeats(buildEmptySeats(8));
            const dealt = startDraft(
                seats,
                packSlots,
                seed,
                getBoosterConfig,
                resolveCardMeta
            );
            return dealt.seats.map((seat) =>
                realBotChoosePickRated(seat, seat.currentPack!, [
                    seat.currentPack!,
                ])
            );
        }

        expect(firstPicks()).toEqual(firstPicks());
    });
});
