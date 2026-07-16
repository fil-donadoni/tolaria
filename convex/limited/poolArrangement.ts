// Pool Arrangement (ADR 0060, issue #1247): pure logic for the per-seat,
// server-persisted layout of the continuous draft→build surface — which
// Mana-Value column each opened Pool card sits in (with a manual override)
// and whether it's parked in the Maindeck or the Sideboard. Kept out of
// `eventTypes.ts` (types only) and `eventProjection.ts` (the privacy
// boundary) the same way `eventLogic.ts`/`draftEngine.ts` keep the actual
// seat-mutation logic out of those two — this module is the thin, pure,
// unit-testable seam the `setPoolArrangementEntry` mutation shell
// (`convex/limitedEvents.ts`) calls into and the frontend derives its
// Maindeck/Sideboard split from (mirrors "one entry per physical card
// opened, not grouped" already established for `LimitedPoolCard`/`pool`
// itself).
import type { LimitedPoolCard, PoolArrangementEntry } from "./eventTypes";

/** A `{ cardId, cardName }` shape — mirrors `DeckCard` (`~/types/game`)
 *  without importing it, the same dependency-free convention
 *  `eventProjection.ts`'s `ReviewDeckCard` already follows (convex/limited
 *  stays decoupled from `src/types`). */
export interface PlainPoolCard {
    cardId: string;
    cardName: string;
}

/** A patch to fold into one seat's Pool Arrangement, keyed by `poolIndex`.
 *  `sideboard`/`column` each independently default to "don't touch" when
 *  omitted; `column: null` explicitly clears a manual override back to auto
 *  (distinct from `column: undefined`, which leaves any existing override
 *  alone). */
export interface ArrangementPatch {
    poolIndex: number;
    sideboard?: boolean;
    column?: number | null;
}

/** Folds `patch` into `arrangement`, returning a NEW array (arrangement
 *  itself is never mutated). An entry that lands back at the fully-default
 *  state (no column override, not sideboarded) is dropped rather than kept
 *  as a no-op row — keeps the persisted array from silently growing forever
 *  as a player toggles a card back and forth. Result is sorted by
 *  `poolIndex` for a deterministic, diff-friendly persisted shape. */
export function upsertPoolArrangementEntry(
    arrangement: readonly PoolArrangementEntry[],
    patch: ArrangementPatch
): PoolArrangementEntry[] {
    const existing = arrangement.find((e) => e.poolIndex === patch.poolIndex);
    const nextSideboard = patch.sideboard ?? existing?.sideboard ?? false;
    const nextColumn =
        patch.column === undefined
            ? existing?.column
            : (patch.column ?? undefined);

    const rest = arrangement.filter((e) => e.poolIndex !== patch.poolIndex);
    const isDefault = !nextSideboard && nextColumn === undefined;
    if (isDefault) return rest;

    const merged: PoolArrangementEntry = { poolIndex: patch.poolIndex };
    if (nextSideboard) merged.sideboard = true;
    if (nextColumn !== undefined) merged.column = nextColumn;
    return [...rest, merged].sort((a, b) => a.poolIndex - b.poolIndex);
}

/** One resolved Pool card placement — the Arrangement's default (Maindeck,
 *  auto column) folded with any recorded override for that `poolIndex`. */
export interface ResolvedPlacement {
    poolIndex: number;
    card: LimitedPoolCard;
    sideboard: boolean;
    /** Manual Mana-Value column override, if the Arrangement records one for
     *  this card. Absent = auto (the card's own mana value). */
    columnOverride?: number;
}

/** Resolves every card in `pool` against `arrangement` (`undefined` = an
 *  untouched seat — every card defaults to Maindeck). Continuous
 *  draft→build (ADR 0060): unlike the pre-#1247 Sealed convention ("every
 *  Pool card starts in the Sideboard"), a card with no recorded Arrangement
 *  entry is ALREADY in the working deck — the whole point of "the draft-time
 *  Pool IS the working deck." */
export function resolvePoolPlacements(
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[] | undefined
): ResolvedPlacement[] {
    const byIndex = new Map((arrangement ?? []).map((e) => [e.poolIndex, e]));
    return pool.map((card, poolIndex) => {
        const entry = byIndex.get(poolIndex);
        return {
            poolIndex,
            card,
            sideboard: entry?.sideboard ?? false,
            columnOverride: entry?.column,
        };
    });
}

/** `resolvePoolPlacements` reshaped into the Maindeck/Sideboard `DeckCard[]`
 *  split the pool deckbuilder surface renders (`PoolDeckbuilderSurface`) —
 *  the seed a freshly-opened draft-time Pool view or a just-completed
 *  Draft's build view starts from, so the Arrangement built during the draft
 *  "carries unchanged into deckbuild" (ADR 0060). */
export function splitPoolByArrangement(
    pool: readonly LimitedPoolCard[],
    arrangement: readonly PoolArrangementEntry[] | undefined
): { cards: PlainPoolCard[]; sideboard: PlainPoolCard[] } {
    const cards: PlainPoolCard[] = [];
    const sideboard: PlainPoolCard[] = [];
    for (const placement of resolvePoolPlacements(pool, arrangement)) {
        const target = placement.sideboard ? sideboard : cards;
        target.push({
            cardId: placement.card.cardId,
            cardName: placement.card.cardName,
        });
    }
    return { cards, sideboard };
}

/** Finds the `poolIndex` of the first card matching `cardId` currently on
 *  the `fromSideboard` side — what a Maindeck⇄Sideboard move (click or drag
 *  on the shared surface) needs to resolve a `cardId`-keyed UI action back to
 *  the `poolIndex` the persistence mutation is keyed on. Mirrors the
 *  existing "first match by cardId" convention `src/lib/deckSideboard.ts`
 *  already uses for the post-draft build view — duplicate copies of the same
 *  card are interchangeable for this purpose. `null` when no such card is
 *  found (stale UI state — e.g. a concurrent update already moved it). */
export function findMovablePoolIndex(
    placements: readonly ResolvedPlacement[],
    cardId: string,
    fromSideboard: boolean
): number | null {
    const hit = placements.find(
        (p) => p.card.cardId === cardId && p.sideboard === fromSideboard
    );
    return hit ? hit.poolIndex : null;
}
