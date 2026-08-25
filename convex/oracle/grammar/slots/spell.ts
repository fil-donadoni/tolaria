/**
 * Slot: instant and sorcery spell text (CR 113.3a).
 *
 * STUB until #2699.
 *
 * This is the slot a permissive compiler would make its catch-all — "anything
 * left over is spell text, do our best". Grammar v0 has NO catch-all at all:
 * this rule fails like the others, so a line no slot understands is `unparsed`
 * rather than a half-lowered Effect Script.
 */

import { notYetImplemented, type Rule } from "../../rule";
import type { SlotIR } from "../ir";

export const SPELL_SLOT = "spell";

export const spellSlot: Rule<SlotIR> = notYetImplemented<SlotIR>(
    SPELL_SLOT,
    "#2699"
);
