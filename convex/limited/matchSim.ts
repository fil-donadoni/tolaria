// Bot-vs-bot match resolution (PRD #1628 stories 18/19/49/50, issue #1642).
// A Swiss round pairs every seat, and a table of 8 seats is mostly bots
// playing bots — pairings nobody can sit down and play. This module decides
// those pairings WITHOUT playing them: it scores each bot's drafted deck, then
// rolls the match off that score difference with an injected RNG.
//
// **Evaluated, not simulated.** The match is deliberately NOT played through
// the GRE. The gameplay Brain is CLIENT-side (ADR 0001) — a real simulation
// would need either a server-side port of it or a connected client driving the
// game, which would let one closed tab freeze the whole table. The evaluator
// sits behind this seam precisely so a future server-side Brain could replace
// it without touching rounds, standings or the schema.
//
// **One card-value authority.** Deck strength does NOT introduce a second
// scoring system: it aggregates the deck through `botDrafter.ts`'s
// `scoreCandidateWithRating` — the exact function the Bot Drafter picks with,
// carrying `cardValueById` (ADR 0018), `RARITY_WEIGHT`, the colour-commitment
// term and the curve term, plus the layered Pick Rating
// (`cardRatings.ts#resolveEventPickRating`). A bot that first-picked bombs and
// stayed two colours is measured by the same yardstick that made it pick that
// way (PRD #1628 story 50).
//
// PURE and DETERMINISTIC — no `Math.random`, no `ctx`, no DB. The RNG is
// injected and the caller seeds it from the pairing's identity
// (`botMatchSeed`), so a re-render can never rewrite a recorded result (PRD
// #1628 story 19).
import type { DeckCard } from "../deckPresets";
import {
    scoreCandidateWithRating,
    type CardEvalMeta,
    type GetPickRating,
} from "./botDrafter";

/** Resolves a BUILT deck's `DeckCard.cardId` (the canonical
 *  `CardDefinition.id`) to the SAME `CardEvalMeta` the Bot Drafter's Pick
 *  Heuristic scores. Structurally identical to `botDrafter.ts`'s
 *  `GetCardEvalMeta`, and named separately only because the two key on
 *  different ids: a pack card carries a printing's `scryfallId`, while a built
 *  deck (`autoBuild.ts`'s `AutoBuiltDeck.cards`) carries the canonical
 *  `cardId`. Injected — like every other resolver in this module — so nothing
 *  here touches the card registry directly. */
export type GetDeckCardEvalMeta = (cardId: string) => CardEvalMeta | null;

/** Match length. Bo3 is the Limited default (PRD #1628 user story 2); Bo1 is
 *  the quick-table option. */
export type BestOf = 1 | 3;

/** A decided bot-vs-bot match — exactly the game score a round pairing records
 *  (`limitedEvents.rounds[].pairings[].result`, minus the `source` tag the
 *  caller stamps as `"simulated"`). `winsA + winsB` is the number of games
 *  actually played. */
export interface BotMatchResult {
    winsA: number;
    winsB: number;
}

/** Per-game win-probability floor/ceiling (PRD #1628: "clamped to roughly
 *  25-75%"). THE design point of this module, in both directions:
 *
 *  - Unclamped above, the strongest deck at the table sweeps deterministically
 *    and the event has no tension — a 3-round Swiss decided before it starts.
 *  - Flat at 50/50, the draft is irrelevant: how well a bot drafted would not
 *    show up in the standings at all (PRD #1628 story 18).
 *
 *  At the ceiling a Bo3 favourite still only wins ~84% of matches, so upsets
 *  happen at a rate a Limited player would recognise. */
export const WIN_PROBABILITY_MIN = 0.25;
export const WIN_PROBABILITY_MAX = 0.75;

/** Logistic scale, expressed in per-card standard deviations of the deck's own
 *  scores (`DeckStrength.spread`): a HALF-spread gap between the two means
 *  saturates the clamp, a ~0.2-spread gap makes the better deck roughly a
 *  60/40 favourite per game.
 *
 *  Measured in SPREADS rather than in raw score points because
 *  `evaluateDeckStrength`'s units are whatever `scoreCandidateWithRating`
 *  currently returns — an absolute logistic scale hard-codes an assumption
 *  about those units and rots silently the next time the Bot Drafter is
 *  retuned. Spread is the evaluator's own yardstick, so this constant survives
 *  a retune.
 *
 *  Half a spread is a LOT: the standard error of a 40-card mean is
 *  `spread / sqrt(40)` ≈ 0.16 spreads, so a half-spread gap between two decks
 *  is a ~3-sigma difference in deck quality — the point at which "clearly the
 *  better deck" stops buying any more edge and the clamp takes over. */
const STRENGTH_GAP_SCALE_IN_SPREADS = 0.5;

/** One built deck's strength, as the two statistics the matchup needs:
 *
 *  - `mean` — the deck's aggregate strength, and the ONLY term that decides
 *    which deck is better. Rankings compare this.
 *  - `spread` — the population standard deviation of the SAME per-card scores.
 *    Never a quality signal in itself; it is purely the SCALE the mean gap is
 *    read against (see `STRENGTH_GAP_SCALE_IN_SPREADS`).
 *
 *  Carrying the spread alongside the mean is what makes `gameWinProbability`
 *  level-independent. A Pick Rating enters `scoreCandidateWithRating` as an
 *  ADDITIVE per-card offset (`(rating - 2.5) * 1000`), so an event that has
 *  ratings shifts every deck's `mean` by hundreds or thousands of points while
 *  leaving `spread` — a centred statistic — untouched. Normalising by anything
 *  derived from the mean (its magnitude, say) would therefore make the SAME
 *  matchup resolve differently just because the event has ratings checked in;
 *  normalising by the spread cannot. */
export interface DeckStrength {
    readonly mean: number;
    readonly spread: number;
}

/** Aggregate strength of ONE built deck (PRD #1628 story 50): the MEAN of
 *  `botDrafter.ts`'s `scoreCandidateWithRating` over the decklist, each card
 *  scored against the REST of the deck as its "pool", plus the SPREAD of those
 *  same per-card scores (see `DeckStrength`).
 *
 *  Scoring against the rest (rather than against the whole deck, or against
 *  nothing) is what makes this measure a DECK rather than a pile of cards, and
 *  it does so entirely through the Bot Drafter's own terms — no second scoring
 *  system, and in particular no invented deck-level mana-base tax:
 *
 *  - **Colour coherence** falls out of the Pick Heuristic's colour-commitment
 *    term. A card in a disciplined two-colour deck shares a colour with ~20
 *    others (basics included, since `CardEvalMeta.colors` is the card's colour
 *    identity); the same card in a five-colour pile shares with ~7, and a lone
 *    splash card shares with nothing and takes the heuristic's own off-colour
 *    penalty — exactly as it would have at pick time.
 *  - **Curve, rarity and raw card quality** come through the same call:
 *    `CURVE_TARGET`, `RARITY_WEIGHT` and `cardValueById` (ADR 0018).
 *  - **Pick Ratings** dominate the `mean` when present, exactly as they do at
 *    pick time. They enter `scoreCandidateWithRating` as a per-card ADDITIVE
 *    offset, so they move `mean` and leave `spread` untouched — which is what
 *    keeps the matchup itself unchanged when the two decks are rated alike
 *    (see `DeckStrength`).
 *
 *  Mean rather than sum so the number stays comparable across decks of
 *  different sizes (a Limited deck is 40 cards, but nothing here depends on
 *  that).
 *
 *  `getPickRating` is OPTIONAL and defaults to "nothing is rated", mirroring
 *  `chooseBotPick`'s own optional parameter: an event on a set with no
 *  checked-in Pick Ratings evaluates on the heuristic alone, unchanged.
 *
 *  Total: never throws. A card `getCardEvalMeta` can't resolve is skipped
 *  (it contributes nothing rather than crashing a round-opening mutation), and
 *  a deck with no resolvable cards at all scores `{ mean: 0, spread: 0 }`. */
export function evaluateDeckStrength(
    deck: readonly DeckCard[],
    getCardEvalMeta: GetDeckCardEvalMeta,
    getPickRating?: GetPickRating
): DeckStrength {
    const metas: CardEvalMeta[] = [];
    for (const card of deck) {
        const meta = getCardEvalMeta(card.cardId);
        if (meta) metas.push(meta);
    }
    if (metas.length === 0) return { mean: 0, spread: 0 };

    const scores: number[] = [];
    for (let i = 0; i < metas.length; i++) {
        const candidate = metas[i];
        const rest = metas.filter((_, j) => j !== i);
        const rating = getPickRating ? getPickRating(candidate.cardId) : null;
        scores.push(scoreCandidateWithRating(candidate, rest, rating));
    }

    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance =
        scores.reduce((sum, s) => sum + (s - mean) * (s - mean), 0) /
        scores.length;
    return { mean, spread: Math.sqrt(variance) };
}

/** The scale ONE matchup is read at: the two decks' typical per-card spread.
 *
 *  A standard deviation is invariant to an additive offset (so an event with
 *  Pick Ratings measures the same as one without) and non-negative by
 *  construction (so it never degenerates near or below zero the way a
 *  magnitude built from the strengths themselves does). Averaged across the
 *  two seats so neither deck alone sets the yardstick. */
function matchupSpread(a: DeckStrength, b: DeckStrength): number {
    return (a.spread + b.spread) / 2;
}

/** Seat A's probability of winning ONE game, from the two deck strengths: a
 *  logistic curve over their mean gap measured in per-card spreads, clamped to
 *  `[WIN_PROBABILITY_MIN, WIN_PROBABILITY_MAX]`. Equal strengths give exactly
 *  0.5, and the function is symmetric — `p(a,b) + p(b,a) === 1` — so which
 *  seat is called A never changes the matchup.
 *
 *  **Level-independent by construction.** The only thing that moves the result
 *  is `mean(A) - mean(B)` relative to the decks' own spread; adding the same
 *  constant to every card in BOTH decks — which is exactly what checking in
 *  Pick Ratings for a set does (`(rating - 2.5) * 1000` per card) — changes
 *  neither term, so a rated event resolves its matches exactly as decisively
 *  as an unrated one (PRD #1628 story 18).
 *
 *  Two decks with no per-card variation at all (`spread === 0` on both sides)
 *  leave no yardstick to measure the gap against: any gap is then unmeasurably
 *  large and resolves straight to the clamp bound.
 *
 *  Exported alongside `simulateBotMatch` because the clamp is an asserted
 *  property of this module, not an implementation detail (issue #1642), and
 *  because a UI explaining a `"simulated"` result wants the odds it was rolled
 *  at without re-rolling the match. */
export function gameWinProbability(a: DeckStrength, b: DeckStrength): number {
    const delta = a.mean - b.mean;
    const spread = matchupSpread(a, b);
    if (spread === 0) {
        if (delta === 0) return 0.5;
        return delta > 0 ? WIN_PROBABILITY_MAX : WIN_PROBABILITY_MIN;
    }
    const gap = delta / (spread * STRENGTH_GAP_SCALE_IN_SPREADS);
    const raw = 1 / (1 + Math.exp(-gap));
    return Math.min(WIN_PROBABILITY_MAX, Math.max(WIN_PROBABILITY_MIN, raw));
}

/** Rolls a bot-vs-bot match to a decision (PRD #1628 story 18). Plays games at
 *  `gameWinProbability(strengthA, strengthB)` until one seat reaches the wins
 *  a `bestOf` match needs — one for Bo1, two for Bo3 — so a Bo3 always ends
 *  2-0, 0-2, 2-1 or 1-2 and never plays a dead third game.
 *
 *  `rng` is injected (`gre/rng.ts#makeRng`, seeded via `botMatchSeed`) and
 *  consumed exactly once per game: the same seed always yields the same score,
 *  which is what makes a recorded result immune to a re-render (story 19). */
export function simulateBotMatch(
    strengthA: DeckStrength,
    strengthB: DeckStrength,
    bestOf: BestOf,
    rng: () => number
): BotMatchResult {
    const winsNeeded = bestOf === 1 ? 1 : 2;
    const probabilityA = gameWinProbability(strengthA, strengthB);

    let winsA = 0;
    let winsB = 0;
    while (winsA < winsNeeded && winsB < winsNeeded) {
        if (rng() < probabilityA) winsA++;
        else winsB++;
    }
    return { winsA, winsB };
}

/** Derives the RNG seed for ONE pairing from its identity (PRD #1628 story
 *  19). Owned by this module rather than each call site so every path that
 *  resolves the same pairing — the round-opening mutation, a replay, a future
 *  admin re-derivation — necessarily lands on the same seed.
 *
 *  FNV-1a over the pairing's identity string, coerced to the signed 32-bit
 *  integer `makeRng` expects. Seat order is part of the identity (a pairing
 *  has a defined seat A and seat B), so the seed is intentionally NOT
 *  symmetric under swapping the seats. */
export function botMatchSeed(
    eventId: string,
    roundNumber: number,
    seatA: number,
    seatB: number
): number {
    const identity = `${eventId}:${roundNumber}:${seatA}:${seatB}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < identity.length; i++) {
        hash ^= identity.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash | 0;
}
