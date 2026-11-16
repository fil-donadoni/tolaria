// Ordered pile fan (issue #9874): a pile whose ORDER is rules-relevant — the
// graveyard: CR 404.1 puts each object "on top of its owner's graveyard", and
// CR 404.3 lets the owner arrange a simultaneous batch (PR #9585) — browses as one fan, bottom
// on the left, top on the right. A display filter (the type segmented control)
// must not collapse the order: a filtered-out card keeps its slot as a
// placeholder, so the cards still showing read at their true depth.
//
// Geometry (prototype verdict, branch `prototype/graveyard-order-overlap`):
// every item shows the strip up to the NEXT item — a real card shows
// `1 - ORDERED_FAN_OVERLAP` of its width, a placeholder only
// `ORDERED_FAN_HIDDEN_STEP` — so a run of hidden cards reads as a tight stack
// of slivers instead of spending the fan's width.

import type { CardInstance } from "~/types/game";

/** Fraction of a card's width each item overlaps its left neighbour when that
 *  neighbour is a real card (45% of each card stays visible). */
export const ORDERED_FAN_OVERLAP = 0.55;

/** Visible step of a placeholder: the item AFTER a placeholder steps in only
 *  this fraction of a card's width. */
export const ORDERED_FAN_HIDDEN_STEP = 0.06;

export type OrderedPileSlot =
    | { kind: "card"; card: CardInstance; position: number }
    | { kind: "hidden"; card: CardInstance; position: number };

/** One slot per card, in pile order (index 0 = bottom, last = top, the engine
 *  array's own order: `fullText.ts` reads `graveyard[length - 1]` as the top).
 *  `position` counts from the top: 1 = the top card. */
export function buildOrderedPileSlots(
    cards: CardInstance[],
    isShown: (card: CardInstance) => boolean
): OrderedPileSlot[] {
    const n = cards.length;
    return cards.map((card, i) => ({
        kind: isShown(card) ? "card" : "hidden",
        card,
        position: n - i,
    }));
}

/** Left offset of slot `index`, as a (negative) multiple of the card width:
 *  0 for the first slot, else minus the overlap its left neighbour allows. */
export function orderedFanMarginFactor(
    slots: OrderedPileSlot[],
    index: number
): number {
    if (index === 0) return 0;
    return slots[index - 1].kind === "hidden"
        ? -(1 - ORDERED_FAN_HIDDEN_STEP)
        : -ORDERED_FAN_OVERLAP;
}

/** Total fan width as a multiple of the card width: one full card plus every
 *  later slot's visible step. Keeps the flex row hugging its content with no
 *  trailing gap, like the plain fan's own width formula. */
export function orderedFanWidthFactor(slots: OrderedPileSlot[]): number {
    let width = slots.length > 0 ? 1 : 0;
    for (let i = 1; i < slots.length; i++) {
        width += 1 + orderedFanMarginFactor(slots, i);
    }
    return width;
}
