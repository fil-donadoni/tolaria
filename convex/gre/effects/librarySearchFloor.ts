// CR 701.23b / 701.23d — the floor of a genuine Library Search (issue #3437).
//
// A search that states a quality ("a basic land card", "a creature card with
// mana value X") never obliges the searcher to find: the library is hidden, so
// they may decline even when a match exists (CR 701.23b). A search for a bare
// quantity ("a card", "three cards") is the opposite — CR 701.23d makes it
// mandatory, and finding as many as exist is the only legal outcome.
//
// The floor is DERIVED from the Op's shape, never hand-written per card: a
// non-empty `EffectCardFilter` IS the engine's representation of "a stated
// quality". One authority for the interpreter and the catalogue census.

import type { EffectCardFilter } from "../../cards/types";

/** True when the filter names at least one card characteristic. */
export function statesCardQuality(filter: EffectCardFilter | undefined) {
    if (filter === undefined) return false;
    return Object.values(filter).some((value) => value !== undefined);
}

/** The minimum a genuine Library Search may require: zero when it states a
 *  quality (CR 701.23b), otherwise the requested `min` unchanged (CR 701.23d). */
export function librarySearchFloor(
    filter: EffectCardFilter | undefined,
    requestedMin: number
): number {
    return statesCardQuality(filter) ? 0 : requestedMin;
}
