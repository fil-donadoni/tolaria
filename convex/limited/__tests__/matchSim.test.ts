// Bot-vs-bot match resolution tests (PRD #1628 story 18/19/49/50, issue
// #1642). Pure functions over an INJECTED rng — no convex-test harness, no
// GRE, no database (project convention, mirrors `botDrafter.bot.test.ts` /
// `autoBuild.bot.test.ts`).
//
// Deck fixtures are built from the REAL card registry: `evaluateDeckStrength`
// reads card quality through the shared `cardValueById` (via
// `botDrafter.ts`'s `scoreCandidateWithRating`), which only resolves against
// real card ids — so a strength ORDERING assertion is only meaningful with
// real cards behind it.
import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import { getCardColorIdentity } from "../../cards/colors";
import { cardValueById } from "../../gre/cardValue";
import { manaValue } from "../../gre/constants";
import { makeRng } from "../../gre/rng";
import type { DeckCard } from "../../deckPresets";
import { RARITY_WEIGHT, type CardEvalMeta, type GetPickRating } from "../botDrafter";
import {
    WIN_PROBABILITY_MAX,
    WIN_PROBABILITY_MIN,
    botMatchSeed,
    evaluateDeckStrength,
    gameWinProbability,
    simulateBotMatch,
    type DeckStrength,
    type GetDeckCardEvalMeta,
} from "../matchSim";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures — real cards, resolved exactly the way `convex/limitedEvents.ts`
// resolves them for the Bot Drafter (`getCardColorIdentity` + `manaValue` +
// printed rarity).
// ─────────────────────────────────────────────────────────────────────────

function deckCard(name: string): DeckCard {
    const def = getCardByName(name);
    return { cardId: def.id, cardName: def.name };
}

/** Builds a decklist from card names, each name repeated `count` times. */
function deckOf(...entries: (string | [string, number])[]): DeckCard[] {
    const cards: DeckCard[] = [];
    for (const entry of entries) {
        const [name, count] = typeof entry === "string" ? [entry, 1] : entry;
        for (let i = 0; i < count; i++) cards.push(deckCard(name));
    }
    return cards;
}

const RED_SPELLS = [
    "Shivan Dragon",
    "Hill Giant",
    "Dwarven Warriors",
    "Goblin Balloon Brigade",
    "Mons's Goblin Raiders",
    "Lightning Bolt",
    "Fireball",
    "Disintegrate",
] as const;

const BLACK_SPELLS = [
    "Sengir Vampire",
    "Bog Wraith",
    "Hypnotic Specter",
    "Scathe Zombies",
    "Bad Moon",
    "Drain Life",
    "Dark Ritual",
    "Raise Dead",
] as const;

const WHITE_SPELLS = [
    "Serra Angel",
    "Wall of Swords",
    "White Knight",
    "Benalish Hero",
    "Swords to Plowshares",
] as const;

const BLUE_SPELLS = [
    "Air Elemental",
    "Phantom Monster",
    "Counterspell",
    "Merfolk of the Pearl Trident",
    "Unsummon",
] as const;

const GREEN_SPELLS = [
    "Craw Wurm",
    "Ironroot Treefolk",
    "Grizzly Bears",
    "Llanowar Elves",
    "Giant Growth",
] as const;

/** A disciplined two-colour R/B deck: 23 spells all castable off two colours,
 *  17 basics of exactly those two colours. */
const TWO_COLOUR_DECK: DeckCard[] = deckOf(
    ...RED_SPELLS,
    ...BLACK_SPELLS,
    ["Shivan Dragon", 2],
    ["Sengir Vampire", 2],
    ["Hypnotic Specter", 1],
    ["Hill Giant", 1],
    ["Lightning Bolt", 1],
    ["Mountain", 9],
    ["Swamp", 8]
);

/** A five-colour pile assembled from the SAME pool of cards: it cherry-picks
 *  the strongest card of every colour — strictly HIGHER raw card quality than
 *  the two-colour deck — but the mana can never support it. */
const FIVE_COLOUR_PILE: DeckCard[] = deckOf(
    "Shivan Dragon",
    "Hill Giant",
    "Dwarven Warriors",
    "Lightning Bolt",
    "Sengir Vampire",
    "Bog Wraith",
    "Hypnotic Specter",
    "Bad Moon",
    ...WHITE_SPELLS,
    ...BLUE_SPELLS,
    ...GREEN_SPELLS,
    ["Mountain", 4],
    ["Swamp", 4],
    ["Plains", 3],
    ["Island", 3],
    ["Forest", 3]
);

/** Resolves any fixture card id back to its `CardEvalMeta`. Built by scanning
 *  every name the fixtures use, so it behaves exactly like the production
 *  registry-backed resolver (and returns `null` for anything unknown). */
const FIXTURE_META = new Map<string, CardEvalMeta>();
for (const name of [
    ...RED_SPELLS,
    ...BLACK_SPELLS,
    ...WHITE_SPELLS,
    ...BLUE_SPELLS,
    ...GREEN_SPELLS,
    "Mountain",
    "Swamp",
    "Plains",
    "Island",
    "Forest",
]) {
    const def = getCardByName(name);
    FIXTURE_META.set(def.id, {
        cardId: def.id,
        colors: getCardColorIdentity(def),
        manaValue: manaValue(def.manaCost),
        rarity: def.rarity,
    });
}
const resolveMeta: GetDeckCardEvalMeta = (cardId) =>
    FIXTURE_META.get(cardId) ?? null;

const noRatings: GetPickRating = () => null;

/** A hand-built `DeckStrength` for the pure-maths assertions: `spread` is the
 *  yardstick the mean gap is read against, so a scalar-only fixture would say
 *  nothing about the scale. `UNIT_SPREAD` keeps the arithmetic readable — a
 *  delta of `d` is a gap of `d / 100` spreads. */
const UNIT_SPREAD = 100;
function strength(mean: number, spread: number = UNIT_SPREAD): DeckStrength {
    return { mean, spread };
}

/** Runs `trials` independent matches, each seeded from its own pairing
 *  identity, and returns how many seat A won. */
function runTrials(
    strengthA: DeckStrength,
    strengthB: DeckStrength,
    bestOf: 1 | 3,
    trials: number
): { winsA: number; winsB: number } {
    let winsA = 0;
    let winsB = 0;
    for (let round = 0; round < trials; round++) {
        const rng = makeRng(botMatchSeed("event-1", round, 0, 1));
        const result = simulateBotMatch(strengthA, strengthB, bestOf, rng);
        if (result.winsA > result.winsB) winsA++;
        else winsB++;
    }
    return { winsA, winsB };
}

// ─────────────────────────────────────────────────────────────────────────

describe("evaluateDeckStrength (issue #1642: one card-value authority)", () => {
    it("ranks a bomb-heavy two-colour deck above a five-colour pile from the same pool", () => {
        const twoColour = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            noRatings
        );
        const pile = evaluateDeckStrength(
            FIVE_COLOUR_PILE,
            resolveMeta,
            noRatings
        );
        expect(twoColour.mean).toBeGreaterThan(pile.mean);
        // The spread is the yardstick the gap is read against, never a quality
        // signal — but it must be a real, positive one.
        expect(twoColour.spread).toBeGreaterThan(0);
        expect(pile.spread).toBeGreaterThan(0);
    });

    it("is a DECK measure, not a pile of card values — the pile has the higher raw card quality and still loses", () => {
        // Cherry-picking the strongest card of every colour genuinely buys the
        // pile better cards; what it cannot buy is a mana base. If deck
        // strength were raw quality alone this ordering would invert.
        const rawQuality = (deck: DeckCard[]): number => {
            const total = deck.reduce((sum, card) => {
                const meta = resolveMeta(card.cardId)!;
                return (
                    sum + cardValueById(meta.cardId) * RARITY_WEIGHT[meta.rarity]
                );
            }, 0);
            return total / deck.length;
        };
        expect(rawQuality(FIVE_COLOUR_PILE)).toBeGreaterThan(
            rawQuality(TWO_COLOUR_DECK)
        );
        expect(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, noRatings).mean
        ).toBeGreaterThan(
            evaluateDeckStrength(FIVE_COLOUR_PILE, resolveMeta, noRatings).mean
        );
    });

    it("is deterministic — the same decklist always evaluates identically", () => {
        expect(evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta)).toEqual(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta)
        );
    });

    it("reads the Bot Drafter's Pick Rating seam — a top-rated deck beats the same cards unrated", () => {
        const bombRatings: GetPickRating = () => 5;
        const dregRatings: GetPickRating = () => 0;
        const bomb = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            bombRatings
        );
        const dreg = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            dregRatings
        );
        const unrated = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            noRatings
        );
        expect(bomb.mean).toBeGreaterThan(unrated.mean);
        expect(unrated.mean).toBeGreaterThan(dreg.mean);
    });

    it("a UNIFORM rating shifts the level and leaves the spread alone (issue #1642 review)", () => {
        // The scale bug this pins: a Pick Rating is an ADDITIVE per-card offset
        // ((rating - 2.5) * 1000), so it moves the mean by hundreds while the
        // per-card dispersion — the yardstick `gameWinProbability` divides by —
        // is a centred statistic and cannot move at all.
        const unrated = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            noRatings
        );
        const rated = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            () => 4
        );
        expect(rated.mean - unrated.mean).toBeCloseTo(1500, 6);
        expect(rated.spread).toBeCloseTo(unrated.spread, 6);
    });

    it("omitting the rating lookup is identical to a lookup that rates nothing", () => {
        expect(evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta)).toEqual(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, noRatings)
        );
    });

    it("survives a deck the registry cannot resolve, and an empty deck", () => {
        expect(evaluateDeckStrength([], resolveMeta)).toEqual({
            mean: 0,
            spread: 0,
        });
        expect(
            evaluateDeckStrength(
                [{ cardId: "not-a-real-card", cardName: "???" }],
                resolveMeta
            )
        ).toEqual({ mean: 0, spread: 0 });
    });
});

describe("gameWinProbability (issue #1642: the 25-75% clamp)", () => {
    it("clamps an overwhelming favourite at the maximum, never higher", () => {
        expect(gameWinProbability(strength(10_000), strength(1))).toBe(
            WIN_PROBABILITY_MAX
        );
        expect(gameWinProbability(strength(1), strength(10_000))).toBe(
            WIN_PROBABILITY_MIN
        );
    });

    it("gives two identical decks an exact coin flip", () => {
        expect(gameWinProbability(strength(180), strength(180))).toBeCloseTo(
            0.5,
            10
        );
        expect(gameWinProbability(strength(0), strength(0))).toBeCloseTo(
            0.5,
            10
        );
    });

    it("is monotone non-decreasing in the strength delta, and strictly rises in the unclamped band", () => {
        // Swept at TWO different strength LEVELS, and the two sweeps must agree
        // curve-for-curve: a resolver that reads the level rather than the gap
        // passes the pinned-level sweep and fails here (issue #1642 review).
        for (const level of [200, 1_700]) {
            let previous = -Infinity;
            for (let delta = -200; delta <= 200; delta += 5) {
                const p = gameWinProbability(
                    strength(level + delta),
                    strength(level)
                );
                expect(p).toBeGreaterThanOrEqual(previous);
                expect(p).toBeGreaterThanOrEqual(WIN_PROBABILITY_MIN);
                expect(p).toBeLessThanOrEqual(WIN_PROBABILITY_MAX);
                expect(p).toBeCloseTo(
                    gameWinProbability(strength(delta), strength(0)),
                    12
                );
                previous = p;
            }
        }
        // A modest edge is a real but non-decisive edge.
        expect(
            gameWinProbability(strength(210), strength(200))
        ).toBeGreaterThan(0.5);
        expect(gameWinProbability(strength(210), strength(200))).toBeLessThan(
            gameWinProbability(strength(240), strength(200))
        );
    });

    it("reads the GAP, not the LEVEL — the same delta resolves identically anywhere on the scale (issue #1642 review)", () => {
        // The regression this pins: a Pick Rating enters as an additive
        // per-card offset, so an event WITH ratings sits ~1500 points higher
        // than the same event without. If the level leaked into the odds, the
        // resolver would degenerate to a coin flip exactly when an event is
        // rated — inverting PRD #1628 story 18.
        const delta = 65.94;
        const reference = gameWinProbability(strength(delta), strength(0));
        for (const level of [0, 200, 1_700, 12_345, -150, -1_700]) {
            expect(
                gameWinProbability(strength(level + delta), strength(level))
            ).toBeCloseTo(reference, 12);
        }
    });

    it("is invariant to sign — two negative strengths measure like two positive ones (issue #1642 review)", () => {
        // Realistically-low Pick Ratings drive strengths negative. A
        // denominator built from the strengths' own magnitude is not a scale
        // at all down there: it made a 0.3 delta a saturated blowout and a
        // 1.0 delta a coin flip.
        expect(
            gameWinProbability(strength(0.4), strength(0.1))
        ).toBeCloseTo(gameWinProbability(strength(-100.3), strength(-100.6)), 12);
        expect(gameWinProbability(strength(0.4), strength(0.1))).toBeLessThan(
            0.51
        );
        expect(
            gameWinProbability(strength(-100), strength(-101))
        ).toBeGreaterThan(gameWinProbability(strength(0.4), strength(0.1)));
    });

    it("measures the gap in the decks' OWN per-card spread, so a rescaled evaluator resolves the same matchup", () => {
        // Spread is the yardstick: doubling every per-card score doubles both
        // the gap and the spread, and the matchup is unchanged.
        expect(gameWinProbability(strength(50, 100), strength(0, 100))).toBeCloseTo(
            gameWinProbability(strength(100, 200), strength(0, 200)),
            12
        );
        // A tighter deck (smaller spread) makes the SAME raw gap decisive.
        expect(
            gameWinProbability(strength(50, 40), strength(0, 40))
        ).toBeGreaterThan(gameWinProbability(strength(50, 400), strength(0, 400)));
    });

    it("resolves two spreadless decks to the clamp bound rather than NaN", () => {
        expect(gameWinProbability(strength(200, 0), strength(100, 0))).toBe(
            WIN_PROBABILITY_MAX
        );
        expect(gameWinProbability(strength(100, 0), strength(200, 0))).toBe(
            WIN_PROBABILITY_MIN
        );
        expect(gameWinProbability(strength(100, 0), strength(100, 0))).toBe(0.5);
    });

    it("is symmetric: swapping the two decks mirrors the probability", () => {
        expect(
            gameWinProbability(strength(240), strength(200)) +
                gameWinProbability(strength(200), strength(240))
        ).toBeCloseTo(1, 10);
    });
});

describe("simulateBotMatch (issue #1642: Bo1/Bo3 rolls over an injected RNG)", () => {
    it("Bo1 plays exactly one game", () => {
        for (let seed = 0; seed < 50; seed++) {
            const r = simulateBotMatch(
                strength(200),
                strength(180),
                1,
                makeRng(seed)
            );
            expect(r.winsA + r.winsB).toBe(1);
            expect(Math.max(r.winsA, r.winsB)).toBe(1);
        }
    });

    it("Bo3 plays two or three games and always reports a legal Bo3 score", () => {
        const seen = new Set<string>();
        for (let seed = 0; seed < 200; seed++) {
            const r = simulateBotMatch(
                strength(200),
                strength(180),
                3,
                makeRng(seed)
            );
            const games = r.winsA + r.winsB;
            expect(games).toBeGreaterThanOrEqual(2);
            expect(games).toBeLessThanOrEqual(3);
            expect(Math.max(r.winsA, r.winsB)).toBe(2);
            expect(Math.min(r.winsA, r.winsB)).toBeLessThan(2);
            seen.add(`${r.winsA}-${r.winsB}`);
        }
        // Every legal Bo3 score is reachable — a 2-0/0-2 only simulator would
        // silently never roll a third game.
        expect(seen).toEqual(new Set(["2-0", "0-2", "2-1", "1-2"]));
    });

    it("the same seed always produces the same result", () => {
        for (const bestOf of [1, 3] as const) {
            const first = simulateBotMatch(
                strength(260),
                strength(190),
                bestOf,
                makeRng(4242)
            );
            const second = simulateBotMatch(
                strength(260),
                strength(190),
                bestOf,
                makeRng(4242)
            );
            expect(second).toEqual(first);
        }
    });

    it("a clearly stronger deck wins a majority of many seeded trials, but not all of them", () => {
        const strong = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            noRatings
        );
        const weak = evaluateDeckStrength(
            FIVE_COLOUR_PILE,
            resolveMeta,
            noRatings
        );
        expect(strong.mean).toBeGreaterThan(weak.mean);

        const { winsA, winsB } = runTrials(strong, weak, 3, 600);
        expect(winsA).toBeGreaterThan(winsB);
        expect(winsA / 600).toBeGreaterThan(0.6);
        // The clamp is the design point: the favourite can never sweep the
        // table deterministically.
        expect(winsB).toBeGreaterThan(30);
    });

    it("resolves a RATED event exactly as decisively as the same unrated one (PRD #1628 story 18)", () => {
        // The regime the whole design rationale is about, and the one the
        // pre-review implementation inverted: with every card rated, the two
        // decks' strengths both jump by +1500 and the favourite collapsed to a
        // 54% Bo3 near-coin-flip. Ratings must move the RANKING, never wash
        // out a matchup that ratings do not actually change.
        const rated: GetPickRating = () => 4;
        const strong = evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, rated);
        const weak = evaluateDeckStrength(FIVE_COLOUR_PILE, resolveMeta, rated);
        expect(strong.mean).toBeGreaterThan(weak.mean);

        const { winsA, winsB } = runTrials(strong, weak, 3, 600);
        expect(winsA / 600).toBeGreaterThan(0.6);
        expect(winsB).toBeGreaterThan(30);

        // …and identically to the unrated event, game for game: a uniform
        // rating offset changes neither deck's standing against the other.
        const unratedTrials = runTrials(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, noRatings),
            evaluateDeckStrength(FIVE_COLOUR_PILE, resolveMeta, noRatings),
            3,
            600
        );
        expect({ winsA, winsB }).toEqual(unratedTrials);
    });

    it("two evenly-matched decks approach a 50% split over many seeded trials", () => {
        const even = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            noRatings
        );
        const { winsA } = runTrials(even, even, 3, 1000);
        expect(winsA / 1000).toBeGreaterThan(0.44);
        expect(winsA / 1000).toBeLessThan(0.56);
    });
});

describe("botMatchSeed (issue #1642: a recorded result is never rewritten)", () => {
    it("is a pure function of the pairing's identity", () => {
        expect(botMatchSeed("evt", 2, 3, 5)).toBe(botMatchSeed("evt", 2, 3, 5));
    });

    it("separates every component of the pairing identity", () => {
        const base = botMatchSeed("evt", 2, 3, 5);
        expect(botMatchSeed("other", 2, 3, 5)).not.toBe(base);
        expect(botMatchSeed("evt", 3, 3, 5)).not.toBe(base);
        expect(botMatchSeed("evt", 2, 4, 5)).not.toBe(base);
        expect(botMatchSeed("evt", 2, 3, 6)).not.toBe(base);
        expect(botMatchSeed("evt", 2, 5, 3)).not.toBe(base);
    });

    it("produces a usable 32-bit integer seed for makeRng", () => {
        const seed = botMatchSeed("evt", 1, 0, 7);
        expect(Number.isInteger(seed)).toBe(true);
        const rng = makeRng(seed);
        const value = rng();
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
    });
});
