// Bot Drafter Pick Heuristic (PRD #1107 stories 8, 9, 27, 29; ADR 0054, issue
// #1113): a bot Seat picks instantly whenever a pack reaches it, computed
// server-side in Convex with no dependency on any connected client —
// deliberately unlike the vs-AI gameplay Bot's client-side ISMCTS Brain
// (`src/lib/ai/brain.ts`). Mirrors `draftEngine.ts`/`eventLogic.ts`'s
// discipline: a plain, pure function of plain data, unit-testable without a
// convex-test harness.
//
// The Pick Heuristic scores every card still in the pack and returns the
// highest scorer:
//
//   score = cardValueById(card) × rarityWeight(rarity)      -- card quality
//         + colorCommitmentTerm(colors, pool)                -- color fit
//         + curveGapTerm(manaValue, pool)                    -- curve needs
//
// * Card quality reuses the shared `cardValueById` (ADR 0018, extracted to
//   `convex/gre/cardValue.ts` for this issue) — the SAME primitive the vs-AI
//   Brain's Hand term uses, so the two never drift apart.
// * Color commitment grows with the seat's already-accumulated Pool: a color
//   already invested in is reinforced, and once enough picks have been made
//   an entirely off-color card is penalized, proportional to how many picks
//   have already committed the seat to its colors (PRD #1107 story 29,
//   acceptance: "prefers on-color over off-color as commitment grows").
// * The curve term rewards a candidate that fills a currently underrepresented
//   mana-value bucket, bounded so it can only ever tip an otherwise-close
//   decision (acceptance: "fills curve gaps").
//
// PURE and DETERMINISTIC: no `Math.random`, no `ctx`. Every score is a
// function of (candidate, already-picked pool) alone; ties are broken by pack
// position (first wins) — the pack itself is already seeded
// (`draftEngine.ts`'s `generateRoundPacks`), so "first in this seeded pack"
// is itself a reproducible, non-arbitrary tiebreak. This satisfies PRD #1107
// acceptance "picks are deterministic given the event seed" with no extra RNG
// plumbing needed on this path.
import type { Color, Rarity } from "../cards/types";
import { cardValueById } from "../gre/cardValue";
import type { DraftPackCard, LimitedPoolCard } from "./eventTypes";

/** The subset of a card's printed characteristics the Pick Heuristic needs
 *  beyond `cardValueById`'s own id-keyed lookup — injected (like
 *  `eventLogic.ts`'s `GetBoosterConfig`/`ResolveCardMeta`) so this module
 *  never touches the card registry directly. */
export interface CardEvalMeta {
    /** Canonical `CardDefinition.id` — the id `cardValueById` scores. */
    cardId: string;
    /** Mana-cost-derived colors (CR 202.2). Empty for a colorless card
     *  (artifact, most lands) — such a card is neutral to color commitment. */
    colors: Color[];
    /** Printed mana value (0 for a card with no mana cost, e.g. a land). */
    manaValue: number;
    /** Printed rarity of THIS printing (CR 206). */
    rarity: Rarity;
}

/** Resolves a drawn card's Scryfall id to its `CardEvalMeta`, or `null` when
 *  the registry can't resolve it (should not happen for a Draftable Set's own
 *  sheets — the draftability gate guarantees every sheet card resolves — but
 *  never assumed away; `chooseBotPick` treats an unresolvable candidate as
 *  the worst possible pick rather than crashing the draft). */
export type GetCardEvalMeta = (scryfallId: string) => CardEvalMeta | null;

/** Resolves a candidate's canonical `cardId` (`CardEvalMeta.cardId`) to its
 *  Pick Rating (`pickRatings.ts`'s `PICK_RATING_MIN..PICK_RATING_MAX` scale),
 *  or `null` when no checked-in Pick Rating file rates this card (no file for
 *  the set at all, or the file simply has no entry for it) — both `null`
 *  cases fall back to the Pick Heuristic alone, identically (see
 *  `scoreCandidateWithRating`). Injected — like `GetCardEvalMeta` — so this
 *  module never touches `pickRatings.ts`'s checked-in registry directly. */
export type GetPickRating = (cardId: string) => number | null;

/** Rarity multiplier on top of raw card quality (PRD #1107 story 29: "card
 *  quality... adjusted by Rarity"). A higher rarity nudges an otherwise close
 *  decision toward the rarer card — real Limited bombs cluster at rare/mythic
 *  — without letting rarity alone override a genuinely much better common
 *  (the multiplier is small relative to `cardValueById`'s spread). */
const RARITY_WEIGHT: Record<Rarity, number> = {
    common: 1.0,
    uncommon: 1.12,
    rare: 1.3,
    mythic: 1.45,
};

/** Bonus per already-picked Pool card sharing a color with the candidate,
 *  scaled against the Forge-scale `cardValueById` magnitudes (a vanilla
 *  creature's latent worth is in the tens/low hundreds) so a handful of
 *  on-color picks meaningfully outweighs a marginal off-color quality edge. */
const COLOR_COMMIT_WEIGHT = 6;

/** Picks before the off-color penalty kicks in at all — the seat is still
 *  "reading signals" / establishing colors for its first few picks, so an
 *  early off-color card is never punished (PRD #1107 story 29: "as
 *  commitment grows" implies no penalty when there is no commitment yet). */
const OFF_COLOR_GRACE_PICKS = 3;

/** Penalty per pick beyond the grace window for a candidate that shares NO
 *  color with anything already in the Pool — grows linearly with picks made,
 *  so the deeper into the draft, the more a wrong-color card is punished. */
const OFF_COLOR_PENALTY_PER_PICK = 3;

/** Curve buckets the heuristic tracks (mana value 1 through 6+, CR 202.3);
 *  0-cost/land cards don't participate in curve scoring. Target counts are a
 *  generic Limited curve shape (a 23-spell deck skewing toward the cheap end)
 *  — not per-set tuned, just enough to reward "I have no 2-drops yet" over
 *  "I have five 5-drops already". */
const CURVE_TARGET: Record<number, number> = {
    1: 2,
    2: 5,
    3: 5,
    4: 4,
    5: 3,
    6: 2,
};
const CURVE_MAX_BUCKET = 6;
const CURVE_BONUS_WEIGHT = 30;

/** Midpoint of the Pick Rating 0-5 scale (`pickRatings.ts`). A rating ABOVE
 *  the neutral point boosts a candidate over the heuristic-only baseline, a
 *  rating BELOW it penalizes — so a rating of exactly 2.5 ("perfectly
 *  average playable") reproduces roughly the same ranking an unrated card
 *  gets from the heuristic alone, while 0 ("never play this") and 5
 *  ("first-pick bomb") pull hard in either direction. */
const PICK_RATING_NEUTRAL = 2.5;

/** Per-rating-point weight applied on top of the Pick Heuristic's own score
 *  (issue #1117: "rating DOMINATES ordering"). Sized comfortably above the
 *  Pick Heuristic's realistic spread — `scoreCandidate`'s quality term tops
 *  out in the low hundreds (a big flying rare) plus at most a few dozen from
 *  color/curve terms — so even a single rating-point gap between two
 *  candidates can never be overturned by the heuristic underneath it. A
 *  `null` rating (see `GetPickRating`) contributes exactly 0 — the pure
 *  heuristic-fallback case. */
const PICK_RATING_DOMINANCE_WEIGHT = 1000;

function curveBucket(mv: number): number {
    return Math.max(1, Math.min(CURVE_MAX_BUCKET, Math.round(mv)));
}

/** Per-color count of already-picked Pool cards sharing that color — the
 *  color-commitment signal (PRD #1107 story 29). */
function colorWeights(
    poolMeta: readonly CardEvalMeta[]
): Partial<Record<Color, number>> {
    const weights: Partial<Record<Color, number>> = {};
    for (const meta of poolMeta) {
        for (const c of meta.colors) {
            weights[c] = (weights[c] ?? 0) + 1;
        }
    }
    return weights;
}

/** Per-curve-bucket count of already-picked NON-land Pool cards — the curve
 *  signal (PRD #1107 story 29: "fills curve gaps"). A 0-mana-value card
 *  (basic land) never contributes: the curve models the spell base, not the
 *  land base. */
function curveCounts(
    poolMeta: readonly CardEvalMeta[]
): Partial<Record<number, number>> {
    const counts: Partial<Record<number, number>> = {};
    for (const meta of poolMeta) {
        if (meta.manaValue <= 0) continue;
        const bucket = curveBucket(meta.manaValue);
        counts[bucket] = (counts[bucket] ?? 0) + 1;
    }
    return counts;
}

/** Scores one candidate card against a seat's already-accumulated Pool
 *  (PRD #1107 story 29). Exported standalone so the heuristic's shape —
 *  quality/rarity/color/curve — is directly unit-testable without needing a
 *  whole pack. */
export function scoreCandidate(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[]
): number {
    const quality =
        cardValueById(candidate.cardId) * RARITY_WEIGHT[candidate.rarity];

    let colorTerm = 0;
    if (candidate.colors.length > 0) {
        const weights = colorWeights(poolMeta);
        const bestAffinity = Math.max(
            0,
            ...candidate.colors.map((c) => weights[c] ?? 0)
        );
        colorTerm += bestAffinity * COLOR_COMMIT_WEIGHT;

        const totalPicks = poolMeta.length;
        if (bestAffinity === 0 && totalPicks > OFF_COLOR_GRACE_PICKS) {
            colorTerm -=
                (totalPicks - OFF_COLOR_GRACE_PICKS) *
                OFF_COLOR_PENALTY_PER_PICK;
        }
    }

    let curveTerm = 0;
    if (candidate.manaValue > 0) {
        const bucket = curveBucket(candidate.manaValue);
        const target = CURVE_TARGET[bucket] ?? 2;
        const have = curveCounts(poolMeta)[bucket] ?? 0;
        if (have < target) {
            curveTerm = (CURVE_BONUS_WEIGHT * (target - have)) / target;
        }
    }

    return quality + colorTerm + curveTerm;
}

/** Scores one candidate the same way `scoreCandidate` does, then layers the
 *  Pick Rating adjustment on top (issue #1117, ADR 0054/0055's Pick Rating
 *  layer). `rating` is `null` for a card with no checked-in Pick Rating entry
 *  (no file for the set, or the file simply doesn't rate this card) — in
 *  that case the result is EXACTLY `scoreCandidate`'s own value, byte-for-
 *  byte, so a Draftable Set with no ratings file (or a card a checked-in
 *  file happens not to cover) drafts on the heuristic alone, unchanged (this
 *  issue's regression acceptance criterion).
 *
 *  When `rating` is present, the adjustment is `(rating - PICK_RATING_NEUTRAL)
 *  * PICK_RATING_DOMINANCE_WEIGHT` — large enough relative to the heuristic's
 *  own spread that a real rating gap between two candidates always survives
 *  underneath it (rating DOMINATES), while two candidates sharing the SAME
 *  rating fall back to comparing on the heuristic term alone (the heuristic
 *  is still the tie-breaker, per this issue's acceptance criteria). */
export function scoreCandidateWithRating(
    candidate: CardEvalMeta,
    poolMeta: readonly CardEvalMeta[],
    rating: number | null
): number {
    const heuristicScore = scoreCandidate(candidate, poolMeta);
    if (rating === null) return heuristicScore;
    return (
        heuristicScore +
        (rating - PICK_RATING_NEUTRAL) * PICK_RATING_DOMINANCE_WEIGHT
    );
}

/** Picks one card from `pack` for a Bot Drafter seat (PRD #1107 stories 8, 9,
 *  27, 29; ADR 0054; Pick Rating layer: issue #1117, ADR 0054/0055). Scores
 *  every candidate via `scoreCandidateWithRating` against the seat's
 *  already-accumulated `pool`, returning the `pickId` of the highest scorer.
 *  Ties break by pack position (first wins). Deterministic: a pure function
 *  of `(pack, pool)` — the caller (`convex/limitedEvents.ts`) never needs to
 *  thread an RNG stream through this path, so it is trivially reproducible
 *  given the event's seed (which already seeds the pack contents via
 *  `generateRoundPacks`).
 *
 *  `getPickRating` is OPTIONAL and defaults to "no ratings at all" (every
 *  candidate scored as `rating: null`) — omitting it reproduces the exact
 *  pre-Pick-Rating-layer behavior, which is how a Draftable Set with no
 *  checked-in ratings file keeps drafting on the heuristic alone.
 *
 *  Throws only when `pack` is empty — the same contract as `applyPick`,
 *  which already guards against calling this with no pack to pick from. A
 *  candidate `getCardEvalMeta` can't resolve is scored as the worst possible
 *  pick rather than thrown on, so one bad registry lookup never blocks the
 *  whole draft. */
export function chooseBotPick(
    pack: readonly DraftPackCard[],
    pool: readonly LimitedPoolCard[],
    getCardEvalMeta: GetCardEvalMeta,
    getPickRating?: GetPickRating
): string {
    if (pack.length === 0) {
        throw new Error("chooseBotPick: pack is empty");
    }
    const poolMeta = pool
        .map((c) => getCardEvalMeta(c.scryfallId))
        .filter((m): m is CardEvalMeta => m !== null);

    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pack.length; i++) {
        const meta = getCardEvalMeta(pack[i].scryfallId);
        const rating =
            meta && getPickRating ? getPickRating(meta.cardId) : null;
        const score = meta
            ? scoreCandidateWithRating(meta, poolMeta, rating)
            : -Infinity;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }
    return pack[bestIndex].pickId;
}
