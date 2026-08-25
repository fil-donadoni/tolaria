/**
 * Shared sub-grammar: CONDITION — "if you control a creature", intervening-if
 * clauses on triggers (CR 603.4).
 *
 * STUB until #2698. "Dropped intervening-if" is a named competitor misparse:
 * the ability still triggers, so nothing looks broken until the game state
 * quietly diverges.
 */

import { notYetImplemented, type Rule } from "../../rule";

export const CONDITION = "condition";

/** Placeholder result type; #2698 replaces it with the real shape. */
export type ConditionIR = never;

export const conditionRule: Rule<ConditionIR> = notYetImplemented<ConditionIR>(
    CONDITION,
    "#2698"
);
