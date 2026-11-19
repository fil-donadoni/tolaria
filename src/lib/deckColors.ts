import { deckColorsOfNonlands } from "@convex/cards/colors";
import type { DeckCard } from "~/types/game";
import {
    registryDeckCardShape,
    type DeckCardShapeResolver,
} from "./deckCardShape";

/**
 * Derives a deck's color identity from its Maindeck contents — the union of
 * every NONLAND card's colors, in WUBRG order (a land's identity adds no
 * colour, issue #9994 — `deckColorsOfNonlands`). Shared between the catalogue-wide deck
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
    const shapes = [];
    for (const card of cards) {
        const shape = resolve(card.cardId, card);
        if (shape) shapes.push(shape);
    }
    return deckColorsOfNonlands(shapes);
}
