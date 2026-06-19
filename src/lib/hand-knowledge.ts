// ADR 0026 / PRD #338 (slice 3) — pure render-model helpers for hand card
// knowledge. The server has already gated identity by `knownTo`: the viewer's
// own hand arrives face-up with a derived `seenByOpponent` flag on the specific
// cards an opponent knows; an opponent's hand arrives as a `(CardInstance |
// null)[]` where known slots carry identity and the rest are `null` backs. These
// helpers only translate that wire shape into the per-card render model the hand
// UI consumes. No game logic, no mutations, raw `knownTo` never reaches here.

import type { CardInstance } from "~/types/game";

/** One slot in a rendered hand. `card` is a real instance for a face-up slot
 *  (the viewer's own card, or a known opponent card) and `null` for a hidden
 *  opponent back. `seenByOpponent` is only ever true on the viewer's OWN cards —
 *  it drives the Arena-style eye badge and is per-card, never whole-hand. */
export interface HandSlot {
    /** Position in the hand as projected (preserves the back count). */
    index: number;
    card: CardInstance | null;
    /** True iff this slot should render face-up (own card or known opponent
     *  card). False for a hidden opponent back. */
    faceUp: boolean;
    /** True iff at least one opponent knows this own-hand card → show the eye
     *  icon. Always false for opponent-hand slots (the eye is an own-hand
     *  affordance). */
    seenByOpponent: boolean;
}

/** True iff this own-hand card should display the eye icon: at least one
 *  opponent legitimately knows its identity (derived `seenByOpponent` flag set
 *  by the projection). Trivially false when the flag is absent. */
export function isSeenByOpponent(card: CardInstance | null): boolean {
    return card?.seenByOpponent === true;
}

/** Builds the per-card render model for a hand.
 *
 *  - `isOwnHand` true: every slot is face-up (`card` is non-null) and carries
 *    the eye flag only where `seenByOpponent` is set — per-card, never the whole
 *    hand.
 *  - `isOwnHand` false (opponent hand): a non-null slot is a card the viewer
 *    legitimately knows and renders face-up; a `null` slot is a hidden back. The
 *    eye flag is never set on an opponent's hand.
 *
 *  Order and length are preserved so the rendered back count is unchanged. */
export function buildHandModel(
    hand: (CardInstance | null)[],
    isOwnHand: boolean
): HandSlot[] {
    return hand.map((card, index) => {
        if (isOwnHand) {
            return {
                index,
                card,
                faceUp: true,
                seenByOpponent: isSeenByOpponent(card),
            };
        }
        return {
            index,
            card,
            faceUp: card !== null,
            seenByOpponent: false,
        };
    });
}
