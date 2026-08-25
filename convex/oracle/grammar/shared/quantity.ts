/**
 * Shared sub-grammar: QUANTITY — "two", "X", "each", "for each Forest you
 * control", "equal to the number of cards in your hand" (CR 107.1, CR 107.3).
 *
 * STUB until #2697. "For each" collapsed to a constant is one of the
 * competitor's named misparse shapes; a quantity is a computed expression or
 * the card does not compile.
 */

import { notYetImplemented, type Rule } from "../../rule";

export const QUANTITY = "quantity";

/** Placeholder result type; #2697 replaces it with the real shape. */
export type QuantityIR = never;

export const quantityRule: Rule<QuantityIR> = notYetImplemented<QuantityIR>(
    QUANTITY,
    "#2697"
);
