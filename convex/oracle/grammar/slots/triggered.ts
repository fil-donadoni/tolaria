/**
 * Slot: triggered abilities (CR 113.3c — "when", "whenever", "at").
 *
 * STUB until #2698. Fails closed; see `activated.ts` for why a stub must fail
 * rather than return an empty result.
 */

import { notYetImplemented, type Rule } from "../../rule";
import type { SlotIR } from "../ir";

export const TRIGGERED_SLOT = "triggered";

export const triggeredSlot: Rule<SlotIR> = notYetImplemented<SlotIR>(
    TRIGGERED_SLOT,
    "#2698"
);
