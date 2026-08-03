/** Ring class for a card tile in a target/choice picker (graveyard target,
 *  exile/discard/convoke/alternative-cost pickers, pile fan dialogs): a
 *  PERSISTENT yellow ring on every eligible-but-unpicked candidate — visible
 *  without hovering, so "what can I click" never depends on a mouseover — and
 *  green once picked. Mirrors `cards-pile.tsx`'s original `selectionRing`
 *  (signal-pending / signal-self, the same amber/emerald pair CR 601.2c /
 *  602.1 target and cost-pick affordances use elsewhere). Extracted here so
 *  every zone-picker dialog shares ONE ring authority instead of each
 *  hand-rolling its own — several had copy-pasted a gold-only variant with NO
 *  persistent candidate ring at all (QA). */
export function pickerRingClass(isSelected: boolean): string {
    return isSelected
        ? "ring-2 ring-signal-self hover:ring-signal-self-strong"
        : "ring-2 ring-signal-pending hover:ring-signal-pending-strong";
}
