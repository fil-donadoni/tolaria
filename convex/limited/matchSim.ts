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
// `scoreCandidate` — the exact function the Bot Drafter picks with, carrying
// `cardValueById` (ADR 0018), `RARITY_WEIGHT`, the colour-commitment term and
// the curve term, plus the layered Pick Rating
// (`cardRatings.ts#resolveEventPickRating`). A bot that first-picked bombs and
// stayed two colours is measured by the same yardstick that made it pick that
// way (PRD #1628 story 50).
//
// **One unit: rating points.** Since ADR 0073 every term the Bot Drafter scores
// with lives on the 0–5 Pick Rating scale — a rating REPLACES the base term
// rather than offsetting it, and the sum of every contextual term is clamped
// into `[0, contextCap]` (≤ 2.0). A deck's strength is therefore a mean rating,
// bounded and interpretable on its own, which is what lets this module read a
// matchup against a FIXED scale instead of against a statistic derived from the
// decks (see `STRENGTH_GAP_SCALE_RATING_POINTS`).
//
// PURE and DETERMINISTIC — no `Math.random`, no `ctx`, no DB. The RNG is
// injected and the caller seeds it from the pairing's identity
// (`botMatchSeed`), so a re-render can never rewrite a recorded result (PRD
// #1628 story 19).
import type { DeckCard } from "../deckPresets";
import {
    DEFAULT_DRAFT_PICKS,
    scoreCandidate,
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

/** Logistic scale of the matchup, in RATING POINTS — the unit ADR 0073 put
 *  every Bot Drafter term on, and the unit an Admin already edits. A mean gap
 *  of this size makes the better deck a ~62/38 favourite per game; `ln(3) ×`
 *  it (≈ 0.55 rating points) saturates the clamp.
 *
 *  Calibrated against the module's own fixtures, in mean rating points: a
 *  disciplined two-colour deck beats a five-colour pile built from the same
 *  card pool by ~1.0–1.3 (decisive at every ratings regime — it should be, the
 *  pile cannot cast its spells), while two decks differing by a single
 *  comparable card land within ~0.05 (a coin flip, as they should). 0.5 puts
 *  the clamp between those two worlds and leaves the realistic middle — two
 *  genuinely drafted decks, ~0.1–0.4 apart — spread across 0.55–0.70, where
 *  the draft shows up in the standings without deciding them (PRD #1628 story
 *  18).
 *
 *  **FIXED, not derived from the decks** (issue #1642 review). The earlier
 *  attempt measured the gap in the decks' own per-card standard deviation,
 *  which makes the RATINGS SHEET set the yardstick: a flat sheet (every card
 *  rated alike — the base term then identical for every card, only the capped
 *  contextual term varying) collapses that dispersion from ~1.42 to ~0.09, so
 *  a near-mirror pair 0.015 apart reads as a maximally lopsided 75/25 match.
 *  Normalising by any statistic of the decks trades level-dependence for
 *  dispersion-dependence — the same defect wearing a different hat. Because
 *  ADR 0073 fixed the units, an absolute scale is now well defined: it is a
 *  number of rating points, and it means the same thing whatever is checked
 *  into the ratings table. Retuning the Bot Drafter's weights cannot move it
 *  either, since every weight it could retune is itself capped in these same
 *  units. */
const STRENGTH_GAP_SCALE_RATING_POINTS = 0.5;

/** One built deck's strength: the deck's aggregate per-card score in RATING
 *  POINTS (ADR 0073's 0–5 scale plus a contextual bonus of at most
 *  `CONTEXT_CAP_LAST_PICK`). The only quantity that decides which deck is
 *  better, and — read against the fixed
 *  `STRENGTH_GAP_SCALE_RATING_POINTS` — the only one the matchup needs.
 *
 *  Deliberately just the mean. An earlier revision also carried the per-card
 *  spread and divided the gap by it; see
 *  `STRENGTH_GAP_SCALE_RATING_POINTS` for why a yardstick derived from the
 *  decks is not one. Nothing here may depend on a statistic of the decks'
 *  internal dispersion, and the type says so by not offering one. */
export interface DeckStrength {
    readonly mean: number;
}

/** Aggregate strength of ONE built deck (PRD #1628 story 50): the MEAN of
 *  `botDrafter.ts`'s `scoreCandidate(...).score` over the decklist, each card
 *  scored against the REST of the deck as its "pool" — a mean rating, in the
 *  rating points ADR 0073 put every term on.
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
 *  - **Pick Ratings** anchor the `mean` when present, exactly as they do at
 *    pick time: since ADR 0073 a rating REPLACES the base term rather than
 *    offsetting it, so a rated deck's mean is its cards' mean rating plus a
 *    contextual bonus — still in rating points, still bounded, and therefore
 *    still read against the same fixed scale an unrated deck is.
 *
 *  Mean rather than sum so the number stays comparable across decks of
 *  different sizes (a Limited deck is 40 cards, but nothing here depends on
 *  that).
 *
 *  Every card is scored at the LAST pick of a draft (`DEFAULT_DRAFT_PICKS`)
 *  rather than at a pick number derived from the decklist's length. A BUILT
 *  deck is a finished deck — the contextual cap that applies to it is the
 *  full-deck one, and pinning it keeps a 40-card deck and a 60-card one
 *  measured against the same cap instead of letting list size quietly scale
 *  the contextual half of the score.
 *
 *  `getPickRating` is OPTIONAL and defaults to "nothing is rated", mirroring
 *  `chooseBotPick`'s own optional parameter: an event on a set with no
 *  checked-in Pick Ratings evaluates on the heuristic alone, unchanged.
 *
 *  Total: never throws. A card `getCardEvalMeta` can't resolve is skipped
 *  (it contributes nothing rather than crashing a round-opening mutation), and
 *  a deck with no resolvable cards at all scores `{ mean: 0 }`. */
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
    if (metas.length === 0) return { mean: 0 };

    let total = 0;
    for (let i = 0; i < metas.length; i++) {
        const candidate = metas[i];
        const rest = metas.filter((_, j) => j !== i);
        const rating = getPickRating ? getPickRating(candidate.cardId) : null;
        total += scoreCandidate(candidate, rest, rating, {
            pickNumber: DEFAULT_DRAFT_PICKS,
        }).score;
    }
    return { mean: total / metas.length };
}

/** Seat A's probability of winning ONE game, from the two deck strengths: a
 *  logistic curve over their mean gap in RATING POINTS, clamped to
 *  `[WIN_PROBABILITY_MIN, WIN_PROBABILITY_MAX]`. Equal strengths give exactly
 *  0.5, and the function is symmetric — `p(a,b) + p(b,a) === 1` — so which
 *  seat is called A never changes the matchup.
 *
 *  **Level-independent by construction.** The only input is
 *  `mean(A) - mean(B)`, so shifting both decks by the same amount — an event
 *  whose whole card pool is rated a point higher than another's — leaves the
 *  matchup alone (PRD #1628 story 18).
 *
 *  **Dispersion-independent by construction** (issue #1642 review). The gap is
 *  divided by a CONSTANT, so nothing about how the decks' own per-card scores
 *  are distributed can change the odds. In particular a flat ratings sheet,
 *  which squeezes every card in every deck toward the same score, cannot turn
 *  a near-mirror into a blowout — the failure a spread-normalised scale has by
 *  construction, and the reason there is no statistic of the decks in this
 *  function at all.
 *
 *  Exported alongside `simulateBotMatch` because the clamp is an asserted
 *  property of this module, not an implementation detail (issue #1642), and
 *  because a UI explaining a `"simulated"` result wants the odds it was rolled
 *  at without re-rolling the match. */
export function gameWinProbability(a: DeckStrength, b: DeckStrength): number {
    const gap = (a.mean - b.mean) / STRENGTH_GAP_SCALE_RATING_POINTS;
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
