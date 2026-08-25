/**
 * Shared sub-grammar: DURATION — "until end of turn", "until your next turn",
 * "for as long as ..." (CR 611.2b).
 *
 * STUB until #2697. A missing duration silently promotes a temporary effect to
 * a permanent one, so this sub-grammar fails rather than defaulting.
 */

import { notYetImplemented, type Rule } from "../../rule";

export const DURATION = "duration";

/** Placeholder result type; #2697 replaces it with the real shape. */
export type DurationIR = never;

export const durationRule: Rule<DurationIR> = notYetImplemented<DurationIR>(
    DURATION,
    "#2697"
);
