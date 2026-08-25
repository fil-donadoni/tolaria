import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";

/** CR 116.2b / 702.37e (issue #2705) — the morph turn-face-up special action:
 *  "Any time you have priority, you may turn a face-down permanent you control
 *  with a morph ability face up … pay that cost, then turn the permanent face
 *  up."
 *
 *  Modeled on {@link CompanionSummonButton}'s bottom-overlay affordance, and
 *  deliberately not on the activated-ability menu: this is a special action,
 *  not an ability (CR 116), it uses no stack, and a face-down permanent has no
 *  abilities at all for that menu to list — the sentinel definition is a
 *  vanilla 2/2. It also cannot live in the menu's shared gating, because the
 *  cost is the HIDDEN card's morph cost, which the client cannot see.
 *
 *  Rendered only when the wire projection's `canTurnFaceUp` is true (the
 *  viewer controls it, holds priority, no other payment is open, and the morph
 *  cost is affordable — `canTurnFaceUp`, `convex/gre/morph.ts`); the server
 *  re-validates regardless. The label deliberately does NOT print the cost:
 *  the button is rendered inside the controller's own board, but the DOM is
 *  the same document a screenshot or a stream would capture, and CR 702.37e
 *  shows the cost to all players only AS the action is taken. */
export default function TurnFaceUpButton({
    cardInstanceId,
}: {
    cardInstanceId: string;
}) {
    const { gameId, playerId } = useGameContext();
    const turnPermanentFaceUp = useMutation(api.game.turnPermanentFaceUp);
    const [busy, setBusy] = useState(false);

    return (
        <button
            type="button"
            disabled={busy}
            aria-label="Turn face up"
            onClick={async (e) => {
                // The permanent sits inside the battlefield's click/drag
                // surface; without this the same click would also select or
                // start attacking with the creature.
                e.stopPropagation();
                if (busy) return;
                setBusy(true);
                try {
                    await turnPermanentFaceUp({
                        gameId,
                        playerId,
                        cardInstanceId,
                    });
                } catch {
                    // Server-side guard rejected (priority shifted, mana no
                    // longer affordable, the permanent left the battlefield) —
                    // the affordance simply disappears on the next state
                    // update.
                } finally {
                    setBusy(false);
                }
            }}
            className="absolute inset-x-0 bottom-0 z-30 rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-elevated/80 disabled:text-text-muted disabled:shadow-none"
        >
            Turn face up
        </button>
    );
}
