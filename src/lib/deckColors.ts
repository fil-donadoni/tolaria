import type { DeckCard } from "~/types/game";
import {
    registryDeckCardShape,
    type DeckCardShapeResolver,
} from "./deckCardShape";

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;

/**
 * Derives a deck's color identity from its Maindeck contents — the union of
 * every card's colors, in WUBRG order. Shared between the catalogue-wide deck
 * builder (`src/components/lobby/deck-builder/deck-builder.tsx`) and the
 * Limited pool-scoped builder (`src/components/deckbuilder/pool-deck-builder.tsx`,
 * issue #1111) — extracted here on its second use (project convention: a
 * closure earns its own module the second time it's needed).
 *
 * `resolve` is the deck-card shape seam (`deckCardShape.ts`), registry-only by
 * default. A Tabletop deck (ADR 0080) passes the catalogue-backed resolver so
 * its unimplemented cards still colour the deck; a card no resolver can
 * describe contributes nothing rather than throwing.
 */
export function computeDeckColors(
    cards: DeckCard[],
    resolve: DeckCardShapeResolver = registryDeckCardShape
): string[] {
    const set = new Set<string>();
    for (const card of cards) {
        for (const color of resolve(card.cardId)?.colors ?? []) set.add(color);
    }
    return COLOR_ORDER.filter((c) => set.has(c));
}
