/**
 * Slot: non-mana activated abilities (CR 113.3b, CR 602.1a).
 *
 * STUB until #2697. It is a rule that always FAILS, never one that returns an
 * empty ability: an unimplemented slot that returns a neutral value is a card
 * that compiles to nothing and reports success, which is the whole defect class
 * this compiler refuses. Failing routes the line to `unparsed` with the
 * fragment recorded, which is also what feeds #2697's backlog.
 */

import { notYetImplemented, type Rule } from "../../rule";
import type { SlotIR } from "../ir";

export const ACTIVATED_SLOT = "activated";

export const activatedSlot: Rule<SlotIR> = notYetImplemented<SlotIR>(
    ACTIVATED_SLOT,
    "#2697"
);
