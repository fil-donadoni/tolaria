import { getDefinition } from "@convex/cards";
import { manaValue } from "@convex/gre/constants";
import type { DeckCard } from "~/types/game";
import { groupIntoFixedColumns } from "~/components/limited/limitedPoolColumns";

export interface DeckPileGroup {
    key: string;
    label: string;
    cards: DeckCard[];
}

/**
 * Groups deck cards into vertical piles for the "mana pile" view.
 * Lands go in a dedicated first pile; remaining cards are bucketed by mana value.
 * Buckets are dynamic — only MV values present in the deck appear.
 */
export function groupDeckIntoPiles(cards: DeckCard[]): DeckPileGroup[] {
    const lands: DeckCard[] = [];
    const byMv = new Map<number, DeckCard[]>();

    for (const card of cards) {
        const def = getDefinition(card.cardId);
        if (def.types.includes("Land")) {
            lands.push(card);
            continue;
        }
        const mv = manaValue(def.manaCost);
        const bucket = byMv.get(mv);
        if (bucket) bucket.push(card);
        else byMv.set(mv, [card]);
    }

    const sortInPlace = (arr: DeckCard[]) =>
        arr.sort(
            (a, b) =>
                a.cardName.localeCompare(b.cardName) ||
                a.cardId.localeCompare(b.cardId)
        );

    const piles: DeckPileGroup[] = [];
    if (lands.length > 0) {
        piles.push({ key: "lands", label: "Lands", cards: sortInPlace(lands) });
    }
    const mvs = [...byMv.keys()].sort((a, b) => a - b);
    for (const mv of mvs) {
        piles.push({
            key: `mv-${mv}`,
            label: `MV ${mv}`,
            cards: sortInPlace(byMv.get(mv)!),
        });
    }
    return piles;
}

/** One fixed maindeck column for the limited deckbuilder (issue #1575) —
 *  mirrors the draft Pool's `PoolColumn` shape (`limitedPoolColumns.ts`) so
 *  both surfaces render/drop into the SAME column identities. */
export interface DeckColumn {
    /** Stable React key AND the column's drag-drop identity suffix. */
    key: string;
    label: string;
    /** Column identity a manual override / drop targets — a numbered
     *  Mana-Value column, or `"lands"`. */
    column: number | "lands";
    cards: DeckCard[];
}

/** Groups deck cards into the SAME fixed column set the draft Pool uses
 *  (Lands + MV 0..MAX_POOL_COLUMN, always all present so every column is a
 *  stable drop target even when empty — issue #1575, ADR 0060). Unlike the
 *  dynamic `groupDeckIntoPiles` above (constructed builder: only non-empty
 *  Mana-Value piles, no manual override), a card's column honours a manual
 *  per-card override via `columnOf` — the seat's Pool Arrangement column,
 *  carried over from the draft phase and persisted on every column drag.
 *  Column resolution itself is delegated to `resolveDisplayColumn` (the draft
 *  Pool's own helper) so the two surfaces never fork the column math. */
export function groupDeckIntoFixedColumns(
    cards: DeckCard[],
    columnOf: (cardId: string) => number | "lands" | undefined
): DeckColumn[] {
    const columns = groupIntoFixedColumns(
        cards,
        (card) => card,
        (card) => columnOf(card.cardId),
        (a, b) =>
            a.cardName.localeCompare(b.cardName) ||
            a.cardId.localeCompare(b.cardId)
    );
    return columns.map((column) => ({
        key: column.key,
        label: column.label,
        column: column.column,
        cards: column.items,
    }));
}
