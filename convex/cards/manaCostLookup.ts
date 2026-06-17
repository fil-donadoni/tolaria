// Cycle-free registry accessor (CR 202.2). The card registry lives in
// `index.ts`, which imports every set module — so a set module can't import
// `index.ts` back without an eval-time import cycle (and `colors.ts` itself
// sits in a `colors → gre/constants → index → colors` cycle, so it can't host
// the injection either without a TDZ hazard).
//
// This module imports ONLY a type (erased at runtime), so it has no runtime
// import edges and can never participate in a cycle. `index.ts` injects a
// `cardId → manaCost` lookup here once the registry is built; set-module
// runtime code (e.g. Jihad's state-trigger, which reads the colours of an
// opponent's permanents from their slim `{ id }` reference) calls
// `manaCostForCardId` at game time, long after injection.

import type { ManaCost } from "./types";

let cardManaCostLookup: ((cardId: string) => ManaCost | undefined) | null =
    null;

/** Injected once by `index.ts` after the registry is built. */
export function setCardManaCostLookup(
    fn: (cardId: string) => ManaCost | undefined
): void {
    cardManaCostLookup = fn;
}

/** Mana cost of a registered card by id, or `undefined` before injection /
 *  for unknown ids. */
export function manaCostForCardId(cardId: string): ManaCost | undefined {
    return cardManaCostLookup ? cardManaCostLookup(cardId) : undefined;
}
