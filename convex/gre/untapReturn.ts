import { removePermanentTo, withCardsExiledBatch } from "./state";
import type { CardInstanceState, GameState } from "./state";

/** CR 502.3 — returns every battlefield permanent marked
 *  `returnToHandAtUntapOf === playerId` to its OWNER's hand. The mark is
 *  deleted first so the one-shot cannot recur, even if an exileOnLeave
 *  replacement redirects the departure (CR 614.6). */
export function returnMarkedPermanentsToHand(
    state: GameState,
    playerId: string
): void {
    const marked = state.players
        .flatMap((p) => p.battlefield)
        .filter((c) => c.returnToHandAtUntapOf === playerId);
    // CR 603.2c — one turn-based return: an exileOnLeave redirect of several
    // of them is one exile occurrence.
    withCardsExiledBatch(state, () => {
        for (let i = 0; i < marked.length; i++) {
            const card = marked[i];
            card.returnToHandAtUntapOf = undefined;
            removePermanentTo(state, card.id, "hand");
        }
    });
}

/** CR 106.4 — reversing the tap-for-mana that armed the mark (the untap
 *  toggle, `untapSourceFromPayment`, `rollbackPendingCast`, `untapForPayment`)
 *  undoes the whole activation, so the pending return goes with it. Shared by
 *  every reversal path beside `restoreExertOnUntap`. */
export function restoreReturnMarkOnUntap(card: CardInstanceState): void {
    card.returnToHandAtUntapOf = undefined;
}
