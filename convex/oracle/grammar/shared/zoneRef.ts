/**
 * Shared sub-grammar: ZONE REFERENCE — "your graveyard", "the battlefield",
 * "its owner's library" (CR 400.1).
 *
 * STUB until #2697.
 */

import { notYetImplemented, type Rule } from "../../rule";

export const ZONE_REF = "zone reference";

/** Placeholder result type; #2697 replaces it with the real shape. */
export type ZoneRefIR = never;

export const zoneRefRule: Rule<ZoneRefIR> = notYetImplemented<ZoneRefIR>(
    ZONE_REF,
    "#2697"
);
