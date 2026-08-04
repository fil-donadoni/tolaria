import { useMemo } from "react";
import { tryGetDefinition } from "@convex/cards";
import { getCardColorIdentity } from "@convex/cards/colors";
import { manaValue } from "@convex/gre/constants";
import { useFullCatalogue, type FullCatalogueRow } from "./fullCatalogue";
import { parseTypeLine } from "./typeLine";

/**
 * The characteristics a deck-list SURFACE needs off a `DeckCard`: which pile it
 * belongs in (Lands vs a Mana-Value bucket) and what it contributes to the
 * deck's colour identity. Deliberately tiny — this is not a `CardDefinition`
 * substitute, it is the projection every deck view actually reads.
 *
 * Why it exists (ADR 0080): a `DeckCard.cardId` is NOT guaranteed to be in the
 * card registry. In the Tabletop (`manual`) format the pool is the whole Full
 * Catalogue — every printed card, implemented or not — so a deck legitimately
 * holds Scryfall print ids the GRE has never heard of. Resolving those through
 * `getDefinition` throws `Card not found: <uuid>` and takes the whole view
 * down; the registry is simply not the authority for a Tabletop deck.
 */
export interface DeckCardShape {
    isLand: boolean;
    manaValue: number;
    /** Colour identity letters, WUBRG subset — unordered. */
    colors: string[];
}

/** Resolves ONE deck card to its display shape, or `null` when nothing on the
 *  client can describe it (unknown to the registry AND the catalogue isn't
 *  loaded). Never throws — an unresolvable card degrades the view, it does not
 *  break it. */
export type DeckCardShapeResolver = (cardId: string) => DeckCardShape | null;

/** Registry-backed resolution: the implemented-card path, and the default for
 *  every surface that never sees a Tabletop deck. */
export const registryDeckCardShape: DeckCardShapeResolver = (cardId) => {
    const def = tryGetDefinition(cardId);
    if (!def) return null;
    return {
        isLand: def.types.includes("Land"),
        manaValue: manaValue(def.manaCost),
        colors: getCardColorIdentity(def),
    };
};

/** Catalogue-backed resolution: a Full Catalogue row carries the printed type
 *  line, converted mana cost and colour identity, which is exactly this shape.
 *  Exported for testing. */
export function catalogueRowShape(row: FullCatalogueRow): DeckCardShape {
    const { types } = parseTypeLine(row.typeLine);
    return {
        isLand: types.includes("Land"),
        manaValue: row.cmc,
        colors: row.colourIdentity.split("").filter((c) => c !== ""),
    };
}

/** Chains registry → catalogue. The registry wins when it knows the card so an
 *  implemented card's shape is unchanged (and stays right even if a catalogue
 *  row disagrees); the catalogue covers everything else. Exported (rather than
 *  only reachable through the hook) so tests and non-React callers can build a
 *  resolver from rows directly. */
export function makeDeckCardShapeResolver(
    rows: readonly FullCatalogueRow[] | undefined
): DeckCardShapeResolver {
    if (!rows || rows.length === 0) return registryDeckCardShape;
    const byPrintId = new Map<string, FullCatalogueRow>();
    for (const row of rows) byPrintId.set(row.printId, row);
    return (cardId) => {
        const fromRegistry = registryDeckCardShape(cardId);
        if (fromRegistry) return fromRegistry;
        const row = byPrintId.get(cardId);
        return row ? catalogueRowShape(row) : null;
    };
}

/**
 * The resolver a deck-list surface should use. `catalogueBacked` is the
 * Tabletop switch: pass `true` for a `manual`-format deck (or the manual deck
 * builder) so catalogue-only cards resolve, `false` everywhere else so no
 * surface pays for the ~34k-row catalogue fetch it doesn't need.
 *
 * Reactive by construction: the returned resolver identity changes when the
 * catalogue finishes loading, so a `useMemo`d grouping keyed on it re-runs
 * instead of freezing the pre-load answer.
 */
export function useDeckCardShapeResolver(
    catalogueBacked: boolean
): DeckCardShapeResolver {
    const { rows } = useFullCatalogue(catalogueBacked);
    return useMemo(() => makeDeckCardShapeResolver(rows), [rows]);
}
