/**
 * Slot: static abilities other than bare keywords (CR 113.3d, CR 604.1).
 *
 * STUB until #2700. Bare keyword LINES are already handled by the keyword-line
 * slot; everything that lowers to a `staticEffects[]` entry (anthems, cost
 * modifiers, characteristic-defining P/T) waits for #2700 and fails closed.
 */

import { notYetImplemented, type Rule } from "../../rule";
import type { SlotIR } from "../ir";

export const STATIC_SLOT = "static";

export const staticSlot: Rule<SlotIR> = notYetImplemented<SlotIR>(
    STATIC_SLOT,
    "#2700"
);
