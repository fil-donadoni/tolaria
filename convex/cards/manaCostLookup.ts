// Cycle-free registry accessor (CR 202.2). The card registry lives in
// `index.ts`, which imports every set module — so a set module can't import
// `index.ts` back without an eval-time import cycle (and `colors.ts` itself
// sits in a `colors → gre/constants → index → colors` cycle, so it can't host
// the injection either without a TDZ hazard).
//
// This module imports ONLY a type (erased at runtime), so it has no runtime
// import edges and can never participate in a cycle. `index.ts` injects a
// `cardId → colour-defining cost` lookup here once the registry is built; set-module
// runtime code (e.g. Jihad's state-trigger, which reads the colours of an
// opponent's permanents from their slim `{ id }` reference) calls
// `colorDefiningCostForCardId` at game time, long after injection.

import type { ManaCost } from "./types";

let cardManaCostLookup: ((cardId: string) => ManaCost | undefined) | null =
    null;

/** Injected once by `index.ts` after the registry is built. */
export function setColorDefiningCostLookup(
    fn: (cardId: string) => ManaCost | undefined
): void {
    cardManaCostLookup = fn;
}

/** The cost a registered card's COLOUR derives from, or `undefined` before
 *  injection / for unknown ids / for a card whose colour no cost defines (a
 *  devoid card is colourless whatever it costs, CR 702.114a). A colour read only:
 *  the mana a card costs is `getInstanceManaCost`'s. */
export function colorDefiningCostForCardId(
    cardId: string
): ManaCost | undefined {
    return cardManaCostLookup ? cardManaCostLookup(cardId) : undefined;
}
