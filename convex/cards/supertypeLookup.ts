// Cycle-free registry accessor for card supertypes (CR 205.4a). Mirrors
// `manaCostLookup.ts`: the registry lives in `index.ts`, which imports every set
// module, so a set module can't import `index.ts` back without an eval-time
// import cycle / TDZ. This module imports ONLY a type (erased at runtime), so it
// has no runtime import edges and never participates in a cycle. `index.ts`
// injects a `cardId → supertypes` lookup here once the registry is built;
// set-module runtime code (snow-matters predicates that read the live snow
// status off a slim `{ id }` reference) calls `supertypesForCardId` at game
// time, long after injection.

import type { CardSupertype } from "./types";

let cardSupertypeLookup:
    | ((cardId: string) => readonly CardSupertype[] | undefined)
    | null = null;

/** Injected once by `index.ts` after the registry is built. */
export function setCardSupertypeLookup(
    fn: (cardId: string) => readonly CardSupertype[] | undefined
): void {
    cardSupertypeLookup = fn;
}

/** Printed supertypes of a registered card by id, or `undefined` before
 *  injection / for unknown ids. */
export function supertypesForCardId(
    cardId: string
): readonly CardSupertype[] | undefined {
    return cardSupertypeLookup ? cardSupertypeLookup(cardId) : undefined;
}
