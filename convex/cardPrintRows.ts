// Card Prints (ADR 0140, issue #4118) — the server boundary that turns the
// print ids a request touches into a `PrintRowIndex`, which
// `convex/cards/printRows.ts` turns into the pure `ResolveCard` /
// `ResolveCardMeta` the format validators and the Limited engine take.
//
// Point reads by `by_printId` only — rows are immutable to a reader and a
// request touches ~70 ids at most (a deck), so no range scan (PRD #4115 usage
// estimate). A Card Definition's own id has NO row (the sync skips the
// printing whose id IS the definition's), so those ids are never read.
import type { QueryCtx } from "./_generated/server";
import {
    indexPrintRows,
    withRowDefinitionIds,
    type PrintRow,
    type PrintRowIndex,
} from "./cards/printRows";
import { withDefinitionId } from "./cards/catalogue";
import { tryGetDefinition } from "./cards/registry";

/** True when `id` is a Card Definition's own id — no `cardPrints` row exists
 *  for it, so the loader skips it. */
function isDefinitionId(id: string): boolean {
    return tryGetDefinition(id)?.id === id;
}

/** Rows for every distinct non-definition id in `ids`, by point read. An id
 *  with no row (a printing the sync has not reached) is simply absent from the
 *  index; the resolver's fallback handles it. */
export async function loadPrintRows(
    ctx: Pick<QueryCtx, "db">,
    ids: Iterable<string>
): Promise<PrintRowIndex> {
    const wanted = [...new Set(ids)].filter((id) => !isDefinitionId(id));
    const rows = await Promise.all(
        wanted.map((id) =>
            ctx.db
                .query("cardPrints")
                .withIndex("by_printId", (q) => q.eq("printId", id))
                .unique()
        )
    );
    return indexPrintRows(
        rows.flatMap((row): PrintRow[] => (row ? [row] : []))
    );
}

interface DeckLike {
    cards: readonly { cardId: string }[];
    sideboard?: readonly { cardId: string }[];
}

/** Rows for every printing a deck's main board and sideboard name. */
export function loadDeckPrintRows(
    ctx: Pick<QueryCtx, "db">,
    deck: DeckLike
): Promise<PrintRowIndex> {
    return loadPrintRows(ctx, [
        ...deck.cards.map((c) => c.cardId),
        ...(deck.sideboard ?? []).map((c) => c.cardId),
    ]);
}

/** Deck entries as a write stores them: every `definitionId` present. A caller
 *  that sent none (a client that predates the field) gets it from its
 *  printing's `cardPrints` row; an entry already carrying one is left alone
 *  and costs no read. A printing with no row degrades to `cardId` itself
 *  (`withDefinitionId`) — the registry no longer knows Print IDs. */
export async function fillDefinitionIds<
    T extends { cardId: string; cardName: string; definitionId?: string },
>(
    ctx: Pick<QueryCtx, "db">,
    cards: readonly T[]
): Promise<(T & { definitionId: string })[]> {
    const index = await loadPrintRows(
        ctx,
        cards.filter((c) => !c.definitionId).map((c) => c.cardId)
    );
    return withRowDefinitionIds(cards, index).map(
        (c) => withDefinitionId(c) as T & { definitionId: string }
    );
}

interface SeatLike {
    deck: {
        cards: readonly { cardId: string; definitionId?: string }[];
        sideboard?: readonly { cardId: string; definitionId?: string }[];
    };
}

/** `seats` with every deck entry's `definitionId` resolved from the
 *  `cardPrints` rows of the printings the seats name — the one place a chosen
 *  printing becomes a Card Definition before `buildInitialGameState` builds the
 *  libraries (ADR 0140 §5-6). The result feeds setup only: it carries a field
 *  the stored `games` / `matchDecks` snapshots do not, so it is never
 *  persisted. */
export async function withSeatDefinitionIds<S extends SeatLike>(
    ctx: Pick<QueryCtx, "db">,
    seats: readonly S[]
): Promise<S[]> {
    const index = await loadPrintRows(
        ctx,
        seats.flatMap((s) =>
            [...s.deck.cards, ...(s.deck.sideboard ?? [])].map((c) => c.cardId)
        )
    );
    return seats.map((seat) => ({
        ...seat,
        deck: {
            ...seat.deck,
            cards: withRowDefinitionIds(seat.deck.cards, index),
            ...(seat.deck.sideboard
                ? {
                      sideboard: withRowDefinitionIds(
                          seat.deck.sideboard,
                          index
                      ),
                  }
                : {}),
        },
    }));
}

/** The first printing row of each of `cardIds` in `setCode`, by Card ID —
 *  Limited's drafted-set basics (issue #5106). One indexed range probe per
 *  Card ID (`by_cardId_set`), never a scan of a basic's ~1,000 printings. A
 *  Card ID with no printing in the Set is simply absent. */
export async function loadPrintIdsInSet(
    ctx: Pick<QueryCtx, "db">,
    cardIds: readonly string[],
    setCode: string
): Promise<ReadonlyMap<string, string>> {
    const rows = await Promise.all(
        [...new Set(cardIds)].map((cardId) =>
            ctx.db
                .query("cardPrints")
                .withIndex("by_cardId_set", (q) =>
                    q.eq("cardId", cardId).eq("set", setCode)
                )
                .first()
        )
    );
    return new Map(
        rows.flatMap((row): [string, string][] =>
            row ? [[row.cardId, row.printId]] : []
        )
    );
}
