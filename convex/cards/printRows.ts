// Card Prints (ADR 0140, issue #4118) — resolvers built from `cardPrints`
// TABLE ROWS, the pure half of "format validation and Limited metadata stop
// reading the print alias". The DB read happens above this module
// (`convex/cardPrintRows.ts`); everything here is synchronous and injectable,
// the same shape `validateDeck` already takes (`ResolveCard`) and the Limited
// engine already takes (`ResolveCardMeta`).
//
// A row is the authority on a PRINTING's Set and Rarity (CR 206 — rarity is a
// printed characteristic, so a reprint may differ from its home set); the
// Card Definition stays the authority on name, Basic and everything else.
// A print id with no row falls back to `resolveDeckCardMeta` — the
// hand-written alias — only until issue #4121 deletes it; after that the same
// line degrades to the definition's own printing without a code change here.
import { resolveDeckCardMeta } from "./catalogue";
import { tryGetDefinition } from "./registry";
import type { Rarity } from "./types";
import type { ResolveCard } from "../formats";
import type { ResolveCardMeta } from "../limited/eventLogic";

/** The `cardPrints` fields a resolver keys on. Structural, so a Convex
 *  `Doc<"cardPrints">` and a test literal both satisfy it. */
export interface PrintRow {
    printId: string;
    cardId: string;
    set: string;
    rarity: Rarity;
}

/** Rows by Print ID — what a boundary loads for the ids a request touches. */
export type PrintRowIndex = ReadonlyMap<string, PrintRow>;

export function indexPrintRows(rows: Iterable<PrintRow>): PrintRowIndex {
    const index = new Map<string, PrintRow>();
    for (const row of rows) index.set(row.printId, row);
    return index;
}

/** `ResolveCard` over table rows: Set and Rarity of the CHOSEN printing come
 *  from its row (Old School judges Set, Alpha 40 caps by Rarity), the rest
 *  from the row's Card Definition. `null` for a row whose Card Definition is
 *  gone — out-of-pool, never a guess. */
export function makeResolveCardFromRows(index: PrintRowIndex): ResolveCard {
    return (cardId) => {
        const row = index.get(cardId);
        if (!row) return resolveDeckCardMeta(cardId);
        const def = tryGetDefinition(row.cardId);
        if (!def) return null;
        return {
            cardId: def.id,
            name: def.name,
            setCode: row.set,
            rarity: row.rarity,
            isBasic: def.supertypes?.includes("Basic") ?? false,
        };
    };
}

/** The Limited engine's `ResolveCardMeta` (Pool/pack entry `cardId` +
 *  `cardName`) over the same rows, so a drawn print-level Scryfall id
 *  resolves to its definition through the table. `null` — never a placeholder
 *  — for an id neither the table nor the registry resolves; every caller
 *  turns that into the id itself (`convex/limitedCardMeta.ts`). */
export function makeResolveCardMetaFromRows(
    index: PrintRowIndex
): ResolveCardMeta {
    const resolve = makeResolveCardFromRows(index);
    return (scryfallId) => {
        const meta = resolve(scryfallId);
        if (!meta) return null;
        const name = meta.name ?? tryGetDefinition(meta.cardId)?.name;
        return name === undefined
            ? null
            : { cardId: meta.cardId, cardName: name };
    };
}
