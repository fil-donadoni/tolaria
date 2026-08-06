import { useMemo } from "react";
import { tryGetDefinition } from "@convex/cards";
import { getCardColorIdentity } from "@convex/cards/colors";
import type {
    CardDefinition,
    CardType,
    Color,
    ManaCost,
} from "@convex/cards/types";
import type { CardLookup } from "@convex/deckLayout";
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

const COLORED: Color[] = ["W", "U", "B", "R", "G"];

/** A `DeckCardShape` re-expressed as the minimal `CardDefinition` the Column
 *  Layout engine's predicates actually read: `types` (the Lands Column), the
 *  mana cost (`manaValue` for the `mv` Grouping, colour pips for the `color`
 *  one) and `name` (the `name` Ordering). Everything else is filler — this is
 *  NOT a registry substitute, it is the projection a catalogue-only Tabletop
 *  card can honestly supply (ADR 0080). */
function syntheticDefinition(
    cardId: string,
    shape: DeckCardShape,
    name: string
): CardDefinition {
    const colors = shape.colors.filter((c): c is Color =>
        (COLORED as string[]).includes(c)
    );
    const manaCost: ManaCost = {
        generic: Math.max(0, shape.manaValue - colors.length),
    };
    for (const color of colors) manaCost[color] = 1;
    return {
        id: cardId,
        name,
        rarity: "common",
        types: (shape.isLand ? ["Land"] : []) as CardType[],
        manaCost: shape.isLand ? undefined : manaCost,
    };
}

/**
 * The `CardLookup` a deckbuilder surface hands the Column Layout engine
 * (`convex/deckLayout.ts`). The registry answers for every implemented card;
 * a card only the Full Catalogue knows (a Tabletop deck, ADR 0080) resolves
 * through `resolve` into a {@link syntheticDefinition} so it still buckets by
 * Mana Value instead of falling into the Catch-All Column — the successor of
 * `groupDeckIntoPiles`' `resolve` seam, in the vocabulary the engine speaks.
 *
 * `nameOf` supplies the deck row's own `cardName` for the synthetic
 * definition, preserving the `cardName`-then-`cardId` ordering every deck
 * surface used before the engine.
 */
export function deckCardLookup(
    resolve: DeckCardShapeResolver = registryDeckCardShape,
    nameOf?: (cardId: string) => string | undefined
): CardLookup {
    return (cardId) => {
        const def = tryGetDefinition(cardId);
        if (def) return def;
        const shape = resolve(cardId);
        if (!shape) return undefined;
        return syntheticDefinition(cardId, shape, nameOf?.(cardId) ?? cardId);
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
