import { tryGetDefinition } from "../cards";
import { deckColorsOfNonlands, getCardColorIdentity } from "../cards/colors";

/** A human deck's colours from its Maindeck's NONLAND cards (issue #9994) —
 *  recomputed here, not read off the saved `colors`, so a deck saved before the
 *  fix (lands counted) reads right too. No card resolving → the saved value. */
export function humanDeckColors(row: {
    cards: { cardId: string; definitionId?: string }[];
    colors: string[];
}): string[] {
    const shapes = [];
    for (const card of row.cards) {
        const def = tryGetDefinition(card.definitionId ?? card.cardId);
        if (def) {
            shapes.push({
                isLand: def.types.includes("Land"),
                colors: getCardColorIdentity(def),
            });
        }
    }
    return shapes.length > 0 ? deckColorsOfNonlands(shapes) : row.colors;
}
