import { cardRingClass } from "./card-ring";

/** Ring class for a card tile in a target/choice picker (graveyard target,
 *  exile/discard/convoke/alternative-cost pickers, pile fan dialogs): a
 *  PERSISTENT `candidate` ring on every eligible-but-unpicked card — visible
 *  without hovering, so "what can I click" never depends on a mouseover — and
 *  `selected` once picked. Extracted here so every zone-picker dialog shares
 *  ONE ring authority instead of each hand-rolling its own — several had
 *  copy-pasted a gold-only variant with NO persistent candidate ring at all
 *  (QA).
 *
 *  Issue #2724 pointed it at the two shared roles (`src/lib/card-ring.ts`):
 *  the pickers used to speak their own amber/emerald pair while the board said
 *  the same two things in violet/ivory, and the ring is now inset on the card's
 *  own corner rather than an outward Tailwind `ring-*`. `card-ring` carries the
 *  card corner too, so a tile no longer needs its own `rounded-*`. */
export function pickerRingClass(isSelected: boolean): string {
    return cardRingClass(isSelected ? "selected" : "candidate");
}
