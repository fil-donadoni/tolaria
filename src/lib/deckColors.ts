import { getDefinition } from "@convex/cards";
import { getCardColors } from "@convex/cards/colors";
import type { DeckCard } from "~/types/game";

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;

/**
 * Derives a deck's color identity from its Maindeck contents — the union of
 * every card's colors, in WUBRG order. Shared between the catalogue-wide deck
 * builder (`src/components/lobby/deck-builder/deck-builder.tsx`) and the
 * Limited pool-scoped builder (`src/components/deckbuilder/pool-deck-builder.tsx`,
 * issue #1111) — extracted here on its second use (project convention: a
 * closure earns its own module the second time it's needed).
 */
export function computeDeckColors(cards: DeckCard[]): string[] {
    const set = new Set<string>();
    for (const card of cards) {
        try {
            const def = getDefinition(card.cardId);
            for (const color of getCardColors(def)) set.add(color);
        } catch {
            // ignore — card may have been removed from the registry
        }
    }
    return COLOR_ORDER.filter((c) => set.has(c));
}
