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

/** Rarity multiplier on top of raw card quality (PRD #1107 story 29: "card
 *  quality... adjusted by Rarity"). A higher rarity nudges an otherwise close
 *  decision toward the rarer card — real Limited bombs cluster at rare/mythic
 *  — without letting rarity alone override a genuinely much better common
 *  (the multiplier is small relative to `cardValueById`'s spread). Exported
 *  (issue #1115) so `autoBuild.ts`'s deck-construction quality scoring shares
 *  the SAME rarity weighting as the Pick Heuristic — one card-quality
 *  authority for both draft-time and build-time decisions. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
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
 *  "I have five 5-drops already". Exported (issue #1115) so `autoBuild.ts`'s
 *  Auto-Build deck construction reuses the SAME curve shape the Pick
 *  Heuristic already uses at draft time — one curve authority, not two. */
export const CURVE_TARGET: Record<number, number> = {
    1: 2,
    2: 5,
    3: 5,
    4: 4,
    5: 3,
    6: 2,
};
export const CURVE_MAX_BUCKET = 6;
const CURVE_BONUS_WEIGHT = 30;

export function curveBucket(mv: number): number {
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

/** Picks one card from `pack` for a Bot Drafter seat (PRD #1107 stories 8, 9,
 *  27, 29; ADR 0054). Scores every candidate via `scoreCandidate` against the
 *  seat's already-accumulated `pool`, returning the `pickId` of the highest
 *  scorer. Ties break by pack position (first wins). Deterministic: a pure
 *  function of `(pack, pool)` — the caller (`convex/limitedEvents.ts`) never
 *  needs to thread an RNG stream through this path, so it is trivially
 *  reproducible given the event's seed (which already seeds the pack
 *  contents via `generateRoundPacks`).
 *
 *  Throws only when `pack` is empty — the same contract as `applyPick`,
 *  which already guards against calling this with no pack to pick from. A
 *  candidate `getCardEvalMeta` can't resolve is scored as the worst possible
 *  pick rather than thrown on, so one bad registry lookup never blocks the
 *  whole draft. */
export function chooseBotPick(
    pack: readonly DraftPackCard[],
    pool: readonly LimitedPoolCard[],
    getCardEvalMeta: GetCardEvalMeta
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
        const score = meta ? scoreCandidate(meta, poolMeta) : -Infinity;
        if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }
    return pack[bestIndex].pickId;
}
