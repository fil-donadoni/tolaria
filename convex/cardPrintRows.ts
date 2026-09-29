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
    type PrintRow,
    type PrintRowIndex,
} from "./cards/printRows";
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
