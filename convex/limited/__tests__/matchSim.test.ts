// Bot-vs-bot match resolution tests (PRD #1628 story 18/19/49/50, issue
// #1642). Pure functions over an INJECTED rng — no convex-test harness, no
// GRE, no database (project convention, mirrors `botDrafter.bot.test.ts` /
// `autoBuild.bot.test.ts`).
//
// Deck fixtures are built from the REAL card registry: `evaluateDeckStrength`
// reads card quality through the shared `cardValueById` (via
// `botDrafter.ts`'s `scoreCandidate`), which only resolves against real card
// ids — so a strength ORDERING assertion is only meaningful with real cards
// behind it.
//
// Since ADR 0073 every strength is in RATING POINTS: a card's base term is its
// Pick Rating (0–5) or the quality heuristic mapped onto the same scale, plus a
// contextual bonus capped at `CONTEXT_CAP_LAST_PICK`. The fixtures below are
// exercised at THREE ratings regimes — unrated, flat-rated and per-card varied
// — because the defect this module keeps re-acquiring is a yardstick that
// silently inherits some property of the ratings sheet.
import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import { getCardColorIdentity } from "../../cards/colors";
import { cardValueById } from "../../gre/cardValue";
import { manaValue } from "../../gre/constants";
import { makeRng } from "../../gre/rng";
import type { DeckCard } from "../../deckPresets";
import {
    PICK_RATING_MAX,
    PICK_RATING_MIN,
} from "../pickRatings";
import {
    CONTEXT_CAP_LAST_PICK,
    RARITY_WEIGHT,
    type CardEvalMeta,
    type GetPickRating,
} from "../botDrafter";
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

/** A NEAR-MIRROR of `TWO_COLOUR_DECK`: the same 39 cards, with the extra Hill
 *  Giant traded for an extra Raise Dead. Two decks this close are the case a
 *  resolver must call a coin flip — and the case a yardstick that inherits the
 *  ratings sheet's dispersion gets catastrophically wrong (issue #1642 second
 *  review: on a spread-normalised scale a FLAT ratings sheet read this pair as
 *  a maximally lopsided 75/25). */
const NEAR_MIRROR_DECK: DeckCard[] = deckOf(
    ...RED_SPELLS,
    ...BLACK_SPELLS,
    ["Shivan Dragon", 2],
    ["Sengir Vampire", 2],
    ["Hypnotic Specter", 1],
    ["Raise Dead", 1],
    ["Lightning Bolt", 1],
    ["Mountain", 9],
    ["Swamp", 8]
);

/** A SLOPPY build of the same two colours: the bombs traded for filler.
 *  Clearly the worse deck, but nowhere near a blowout — the realistic middle
 *  band, and the only fixture pair whose odds land strictly INSIDE the clamp,
 *  which is what makes it usable as a comparison that could actually diverge. */
const SLOPPY_DECK: DeckCard[] = deckOf(
    ...RED_SPELLS,
    ...BLACK_SPELLS,
    ["Scathe Zombies", 2],
    ["Mons's Goblin Raiders", 2],
    ["Goblin Balloon Brigade", 1],
    ["Raise Dead", 1],
    ["Dwarven Warriors", 1],
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

// ── The three ratings regimes ────────────────────────────────────────────
// Every property this module claims has to hold at all three. The first two
// are the degenerate ends (nothing rated / everything rated alike); the third
// is PRODUCTION — the Vintage Cube is fully rated card-by-card (ADR 0066), and
// it is the regime the constant-function fixtures below never reached.

const noRatings: GetPickRating = () => null;

/** Every card rated the SAME. Degenerate on purpose: with the base term
 *  identical for every card in every deck, the only per-card variation left is
 *  the capped contextual term, so the decks' internal dispersion collapses by
 *  more than an order of magnitude (~1.42 → ~0.09 rating points on these
 *  fixtures). Any yardstick derived from that dispersion silently rescales the
 *  whole table here. */
const flatRatings: GetPickRating = () => 4;

/** A per-card VARIED ratings sheet — the production regime (issue #1642 second
 *  review: every previous rating fixture was a CONSTANT function, i.e. exactly
 *  the one case an invariance claim holds for trivially). Deterministic FNV-1a
 *  over the cardId spread across the full `[PICK_RATING_MIN, PICK_RATING_MAX]`
 *  range, so the sheet is arbitrary but reproducible and always in range. */
const variedRatings: GetPickRating = (cardId) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < cardId.length; i++) {
        hash ^= cardId.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    const steps = (PICK_RATING_MAX - PICK_RATING_MIN) * 100 + 1;
    return PICK_RATING_MIN + ((hash >>> 0) % steps) / 100;
};

const REGIMES: readonly (readonly [string, GetPickRating])[] = [
    ["unrated", noRatings],
    ["flat-rated", flatRatings],
    ["per-card varied", variedRatings],
];

/** A hand-built `DeckStrength` for the pure-maths assertions. Since ADR 0073 a
 *  strength IS a mean rating, so these are read directly in rating points —
 *  there is no second statistic, by design (a yardstick built from one is the
 *  defect this module twice acquired). */
function strength(mean: number): DeckStrength {
    return { mean };
}

/** The mean gap, in rating points, that `gameWinProbability` turns into the
 *  clamp bound: `scale × ln 3`, since `1/(1+e^-g) = 0.75` at `g = ln 3`. Below
 *  it the odds are strictly inside the clamp and a comparison can diverge;
 *  above it every gap reads the same. */
const SATURATION_DELTA = 0.5 * Math.log(3);

/** A gap comfortably INSIDE the clamp — the band a comparison has to be pinned
 *  at for it to mean anything (issue #1642 second review: the previous
 *  600-trial equality sat at the bound on both sides, so it asserted a clamp
 *  identity rather than an invariance). */
const UNCLAMPED_DELTA = 0.2;

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
    });

    it("scores in RATING POINTS — a strength stays on the Pick Rating scale plus at most the contextual cap (ADR 0073)", () => {
        // What makes a FIXED matchup scale well defined at all: the units are
        // the ones an Admin edits, and they are bounded. A strength that could
        // wander onto an arbitrary scale would put us straight back to needing
        // a yardstick derived from the decks.
        for (const [, getRating] of REGIMES) {
            for (const deck of [
                TWO_COLOUR_DECK,
                FIVE_COLOUR_PILE,
                SLOPPY_DECK,
            ]) {
                const { mean } = evaluateDeckStrength(
                    deck,
                    resolveMeta,
                    getRating
                );
                expect(mean).toBeGreaterThanOrEqual(PICK_RATING_MIN);
                expect(mean).toBeLessThanOrEqual(
                    PICK_RATING_MAX + CONTEXT_CAP_LAST_PICK
                );
            }
        }
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

    it("a UNIFORM rating REPLACES the base term, it does not offset it (ADR 0073)", () => {
        // The rebase this module had to absorb: pre-ADR-0073 a rating was an
        // additive `(rating - 2.5) * 1000` offset, and this test asserted a
        // +1500 shift. It is now the anchor itself, so a flat sheet pins every
        // card's base term at the rated value and the deck's mean lands within
        // one contextual cap of it — regardless of what the cards actually are.
        const rated = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            flatRatings
        );
        expect(rated.mean).toBeGreaterThanOrEqual(4);
        expect(rated.mean).toBeLessThanOrEqual(4 + CONTEXT_CAP_LAST_PICK);

        // …and the same flat sheet lands the five-colour pile in the same
        // band. Ratings alone can no longer separate two decks; what still
        // separates them is the contextual half, which is exactly why a
        // flat sheet squeezes the whole table together.
        const pile = evaluateDeckStrength(
            FIVE_COLOUR_PILE,
            resolveMeta,
            flatRatings
        );
        expect(pile.mean).toBeGreaterThanOrEqual(4);
        expect(pile.mean).toBeLessThanOrEqual(4 + CONTEXT_CAP_LAST_PICK);
    });

    it("a per-card VARIED sheet moves the ranking, and a deck of bombs still beats a deck of dregs", () => {
        // The production regime (ADR 0066: the Vintage Cube is fully rated).
        // Every earlier rating fixture was a constant function, so nothing
        // exercised a sheet that actually differs card to card.
        const varied = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            variedRatings
        );
        const unrated = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            noRatings
        );
        expect(varied.mean).not.toBeCloseTo(unrated.mean, 3);

        // A varied sheet is still a sheet: rating every card of one deck top
        // and every card of the other bottom must order them that way.
        const allBombs = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            () => PICK_RATING_MAX
        );
        const allDregs = evaluateDeckStrength(
            TWO_COLOUR_DECK,
            resolveMeta,
            () => PICK_RATING_MIN
        );
        expect(allBombs.mean).toBeGreaterThan(varied.mean);
        expect(varied.mean).toBeGreaterThan(allDregs.mean);
    });

    it("omitting the rating lookup is identical to a lookup that rates nothing", () => {
        expect(evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta)).toEqual(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, noRatings)
        );
    });

    it("survives a deck the registry cannot resolve, and an empty deck", () => {
        expect(evaluateDeckStrength([], resolveMeta)).toEqual({ mean: 0 });
        expect(
            evaluateDeckStrength(
                [{ cardId: "not-a-real-card", cardName: "???" }],
                resolveMeta
            )
        ).toEqual({ mean: 0 });
    });
});

describe("gameWinProbability (issue #1642: the 25-75% clamp)", () => {
    it("clamps an overwhelming favourite at the maximum, never higher", () => {
        expect(gameWinProbability(strength(5), strength(0))).toBe(
            WIN_PROBABILITY_MAX
        );
        expect(gameWinProbability(strength(0), strength(5))).toBe(
            WIN_PROBABILITY_MIN
        );
    });

    it("gives two identical decks an exact coin flip", () => {
        expect(gameWinProbability(strength(3.5), strength(3.5))).toBeCloseTo(
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
        for (const level of [2.0, 4.5]) {
            let previous = -Infinity;
            for (let step = -40; step <= 40; step++) {
                const delta = step / 40;
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
        expect(gameWinProbability(strength(2.05), strength(2))).toBeGreaterThan(
            0.5
        );
        expect(gameWinProbability(strength(2.05), strength(2))).toBeLessThan(
            gameWinProbability(strength(2.2), strength(2))
        );
    });

    it("saturates the clamp at `scale × ln 3` rating points, and not before (calibration)", () => {
        // Pins the ONE tuning number in the module, in the units it is
        // expressed in. Below the saturation gap the odds carry information;
        // at and above it every matchup reads alike.
        expect(
            gameWinProbability(strength(SATURATION_DELTA * 0.99), strength(0))
        ).toBeLessThan(WIN_PROBABILITY_MAX);
        expect(
            gameWinProbability(strength(SATURATION_DELTA * 1.01), strength(0))
        ).toBe(WIN_PROBABILITY_MAX);
        // The realistic middle: a fifth of a rating point is a real edge, and
        // a long way from decisive.
        expect(
            gameWinProbability(strength(UNCLAMPED_DELTA), strength(0))
        ).toBeCloseTo(1 / (1 + Math.exp(-0.4)), 10);
    });

    it("reads the GAP, not the LEVEL — the same delta resolves identically anywhere on the scale (issue #1642 review)", () => {
        // An event whose whole pool is rated a point higher than another's
        // sits a point higher in mean. If the level leaked into the odds, that
        // event's matches would resolve differently for no reason at all —
        // inverting PRD #1628 story 18.
        const reference = gameWinProbability(
            strength(UNCLAMPED_DELTA),
            strength(0)
        );
        for (const level of [0, 1, 2.5, 5, 6.9, -1.5, -40]) {
            expect(
                gameWinProbability(
                    strength(level + UNCLAMPED_DELTA),
                    strength(level)
                )
            ).toBeCloseTo(reference, 12);
        }
    });

    it("is invariant to sign — two negative strengths measure like two positive ones (issue #1642 review)", () => {
        // A denominator built from the strengths' own magnitude is not a scale
        // at all down here: it made a 0.3 delta a saturated blowout and a
        // 1.0 delta a coin flip.
        expect(gameWinProbability(strength(0.4), strength(0.1))).toBeCloseTo(
            gameWinProbability(strength(-100.3), strength(-100.6)),
            12
        );
    });

    it("reads the gap against a FIXED scale — nothing about the decks sets the yardstick (issue #1642 second review)", () => {
        // THE defect this replaced. The previous revision divided the gap by
        // the decks' own per-card standard deviation, which fixed
        // level-dependence by acquiring dispersion-dependence: identical mean
        // gaps resolved differently depending on how internally varied the two
        // decks happened to be, and therefore on what the ratings sheet
        // happened to contain. `DeckStrength` no longer carries a second
        // statistic, so the only way this can regress is by deriving one.
        const gaps = [0.01, 0.05, UNCLAMPED_DELTA, 0.4];
        for (const gap of gaps) {
            const reference = gameWinProbability(strength(gap), strength(0));
            // A gap of `g` means the same thing whatever the decks it came
            // from — and in particular is not a function of any per-deck
            // dispersion, because there is none to read.
            expect(reference).toBeCloseTo(
                1 / (1 + Math.exp(-gap / 0.5)),
                12
            );
        }
        // A hundredth of a rating point is a coin flip. On the spread-scaled
        // predecessor, with a FLAT ratings sheet squeezing per-card dispersion
        // to ~0.09, this same gap read as a 0.56 favourite — and 0.07 read as
        // the clamp bound.
        expect(gameWinProbability(strength(0.01), strength(0))).toBeLessThan(
            0.51
        );
        expect(gameWinProbability(strength(0.07), strength(0))).toBeLessThan(
            0.54
        );
    });

    it("is symmetric: swapping the two decks mirrors the probability", () => {
        expect(
            gameWinProbability(strength(2.4), strength(2)) +
                gameWinProbability(strength(2), strength(2.4))
        ).toBeCloseTo(1, 10);
    });
});

describe("the yardstick survives every ratings regime (issue #1642 second review)", () => {
    // The measurement that decides whether the scale is real: the SAME two
    // matchups — one decisive, one near-mirror — read at all three regimes.
    // A yardstick that inherits anything from the ratings sheet moves one of
    // these two rows; a fixed one moves neither meaningfully.

    const decisive = (getRating: GetPickRating) =>
        gameWinProbability(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, getRating),
            evaluateDeckStrength(FIVE_COLOUR_PILE, resolveMeta, getRating)
        );

    const nearMirror = (getRating: GetPickRating) =>
        gameWinProbability(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, getRating),
            evaluateDeckStrength(NEAR_MIRROR_DECK, resolveMeta, getRating)
        );

    it.each(REGIMES.map(([name]) => name))(
        "a decisive matchup stays decisive — %s",
        (name) => {
            const getRating = REGIMES.find(([n]) => n === name)![1];
            // A deck that can cast its spells against one that cannot is the
            // clearest matchup these fixtures can express; a scale with any
            // resolution at all must call it lopsided at every regime.
            expect(decisive(getRating)).toBeGreaterThan(0.65);
        }
    );

    it.each(REGIMES.map(([name]) => name))(
        "a near-mirror stays a coin flip — %s",
        (name) => {
            const getRating = REGIMES.find(([n]) => n === name)![1];
            // The failing case. On the spread-normalised predecessor the
            // FLAT-rated row read 0.60 for this pair (and 0.75 for a pair 0.07
            // apart) purely because a flat sheet collapses per-card dispersion
            // — the ratings sheet setting the yardstick.
            expect(nearMirror(getRating)).toBeGreaterThan(0.45);
            expect(nearMirror(getRating)).toBeLessThan(0.55);
        }
    );

    it("a SMALLER mean gap never produces LONGER odds, whatever the ratings sheet", () => {
        // The sharpest statement of the defect, and the one that fails loudest
        // on a dispersion-normalised scale. Take ONE pair of decks and read it
        // at all three regimes: the odds must order the same way the mean gaps
        // do, because the odds are supposed to be a function of the gap.
        //
        // Measured on the predecessor, for this exact pair: the flat-rated
        // sheet SHRANK the gap 6.6× (0.136 → 0.021) and yet LENGTHENED the
        // odds (0.550 → 0.593), because collapsing per-card dispersion shrank
        // the yardstick faster than it shrank the gap. Any scale that is a
        // genuine function of the gap alone satisfies this by construction; a
        // scale with a second input cannot.
        const readings = REGIMES.map(([name, getRating]) => {
            const a = evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, getRating);
            const b = evaluateDeckStrength(SLOPPY_DECK, resolveMeta, getRating);
            return { name, delta: a.mean - b.mean, p: gameWinProbability(a, b) };
        });
        for (const x of readings) {
            for (const y of readings) {
                if (x.delta <= y.delta) continue;
                expect(
                    x.p,
                    `${x.name} (gap ${x.delta.toFixed(4)}) must not be shorter odds than ${y.name} (gap ${y.delta.toFixed(4)})`
                ).toBeGreaterThanOrEqual(y.p);
            }
        }
    });

    it("a per-card VARIED sheet does not wash out a matchup relative to unrated", () => {
        // The regime the constant-function fixtures could never reach: with
        // ratings differing card by card, a yardstick built from per-card
        // dispersion inflates and compresses every gap toward a coin flip.
        const unrated = decisive(noRatings);
        const varied = decisive(variedRatings);
        expect(varied).toBeGreaterThan(0.65);
        // "Not washed out" means measurably so: the varied reading may not
        // give back most of the unrated edge over a coin flip.
        expect(varied - 0.5).toBeGreaterThan((unrated - 0.5) * 0.8);
    });

    it("the middle band is INSIDE the clamp, so the scale has resolution to lose", () => {
        // Every fixture pair above sits at one bound or dead centre. Without a
        // pair strictly between them, "the odds are correct" is unfalsifiable:
        // a broken scale that saturated everything would pass the decisive row
        // and a broken one that flattened everything would pass the mirror row.
        const p = gameWinProbability(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, noRatings),
            evaluateDeckStrength(SLOPPY_DECK, resolveMeta, noRatings)
        );
        expect(p).toBeGreaterThan(0.52);
        expect(p).toBeLessThan(WIN_PROBABILITY_MAX);
    });
});

describe("simulateBotMatch (issue #1642: Bo1/Bo3 rolls over an injected RNG)", () => {
    it("Bo1 plays exactly one game", () => {
        for (let seed = 0; seed < 50; seed++) {
            const r = simulateBotMatch(
                strength(3),
                strength(2.8),
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
                strength(3),
                strength(2.8),
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
                strength(3.6),
                strength(2.9),
                bestOf,
                makeRng(4242)
            );
            const second = simulateBotMatch(
                strength(3.6),
                strength(2.9),
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

    it("resolves a matchup identically at any LEVEL, pinned at an UNCLAMPED gap (PRD #1628 story 18)", () => {
        // Pinned strictly inside the clamp on purpose (issue #1642 second
        // review). The predecessor of this test ran two real-deck matchups
        // that BOTH sat exactly at `WIN_PROBABILITY_MAX`, so its 600-trial
        // `toEqual` compared two runs that could not have differed whatever
        // the resolver did — it asserted a clamp identity, not an invariance.
        // At a 0.2-point gap the odds are ~0.599 and a level leak of any size
        // moves the trial count immediately.
        const low = runTrials(
            strength(2 + UNCLAMPED_DELTA),
            strength(2),
            3,
            600
        );
        const high = runTrials(
            strength(4.5 + UNCLAMPED_DELTA),
            strength(4.5),
            3,
            600
        );
        expect(high).toEqual(low);

        // …and the pinned matchup is genuinely mid-band: a real edge that is
        // nowhere near the bound, so both numbers above are informative.
        expect(low.winsA).toBeGreaterThan(low.winsB);
        expect(low.winsA / 600).toBeLessThan(0.8);
    });

    it("resolves a RATED event as decisively as the same unrated one (PRD #1628 story 18)", () => {
        // Ratings must move the RANKING, never wash out a matchup. Note what
        // is NOT claimed here since ADR 0073: a flat sheet REPLACES every base
        // term, so the two decks' gap genuinely changes and game-for-game
        // equality would be an opinion about the sheet, not an invariant. What
        // must hold is that the favourite stays the favourite by a comparable
        // margin — at every regime, including a per-card varied sheet.
        const unrated = runTrials(
            evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, noRatings),
            evaluateDeckStrength(FIVE_COLOUR_PILE, resolveMeta, noRatings),
            3,
            600
        );
        for (const [, getRating] of REGIMES) {
            const { winsA, winsB } = runTrials(
                evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, getRating),
                evaluateDeckStrength(FIVE_COLOUR_PILE, resolveMeta, getRating),
                3,
                600
            );
            expect(winsA / 600).toBeGreaterThan(0.6);
            expect(winsB).toBeGreaterThan(30);
            expect(Math.abs(winsA - unrated.winsA)).toBeLessThan(60);
        }
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

    it("a NEAR-MIRROR pair rolls close to even at every ratings regime", () => {
        // The trial-level counterpart of the near-mirror probability rows: a
        // yardstick that inherits the sheet's dispersion turns this into a
        // ~84% Bo3 sweep for whichever deck happens to be a hundredth of a
        // point ahead.
        for (const [, getRating] of REGIMES) {
            const { winsA } = runTrials(
                evaluateDeckStrength(TWO_COLOUR_DECK, resolveMeta, getRating),
                evaluateDeckStrength(NEAR_MIRROR_DECK, resolveMeta, getRating),
                3,
                600
            );
            expect(winsA / 600).toBeGreaterThan(0.4);
            expect(winsA / 600).toBeLessThan(0.6);
        }
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
