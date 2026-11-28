// Forage (CR 701.61) — the two halves of the keyword action.
//
// CR 701.61a: To forage means "Exile three cards from your graveyard or
//   sacrifice a Food."
//
// The forager chooses ONE half, and may choose only a half they can perform
// in full (CR 118.3 — three cards, never two; a Food they control). This
// module names the halves and decides which are open; the `forage` Op
// (`gre/effects/interpreter.ts`) asks, picks and performs. Nothing here moves
// a card.

import type { PermanentFilter } from "../cards/filters";

/** CR 701.61a — the cards the graveyard half exiles. */
export const FORAGE_EXILE_COUNT = 3;

/** CR 701.61a — the permanent the sacrifice half gives up: a Food (CR
 *  205.3g, an artifact subtype). */
export const FORAGE_FOOD_FILTER: PermanentFilter = { subtypes: "Food" };

/** The two halves, by the option id the forager's pick names. */
export type ForageHalf = "exile" | "sacrifice";

/** The label each half carries on the forager's pick. */
export const FORAGE_HALF_LABEL: Record<ForageHalf, string> = {
    exile: "Exile three cards from your graveyard",
    sacrifice: "Sacrifice a Food",
};

/** CR 701.61a + CR 118.3 — the halves a player can perform right now, in
 *  printed order: the graveyard half needs three cards in their graveyard,
 *  the sacrifice half a Food they control. Empty = they cannot forage. */
export function openForageHalves(
    graveyardCount: number,
    foodCount: number
): ForageHalf[] {
    const halves: ForageHalf[] = [];
    if (graveyardCount >= FORAGE_EXILE_COUNT) halves.push("exile");
    if (foodCount >= 1) halves.push("sacrifice");
    return halves;
}
