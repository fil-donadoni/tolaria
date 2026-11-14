import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { graveyardOrderCards } from "~/lib/graveyard-order";
import LibraryOrderPicker from "./library-order/library-order-picker";

/** Full-screen picker for a `graveyard-order` choice (CR 404.3, issue #9554):
 *  the owner arranges the cards one event put into their graveyard together.
 *  Mounted by the board beside `PutBackPicker`, and drives the same ordered
 *  drag strip (`LibraryOrderPicker` `graveyardOrder` mode): rightmost = top of
 *  the graveyard, confirming without a drag keeps the engine's order. "Order
 *  randomly" submits `orderRandomly` — the server draws the order from the
 *  game's seeded PRNG, never a client shuffle. */
export default function GraveyardOrderPicker() {
    const { gameId, playerId, allPlayers, pendingChoices } = useGameContext();
    const submitChoice = useMutation(api.game.submitResolutionChoice);
    const [submitting, setSubmitting] = useState(false);

    const head = pendingChoices?.[0];
    if (!head || head.kind !== "graveyard-order" || head.playerId !== playerId)
        return null;

    const cards = graveyardOrderCards(head, allPlayers);

    const submit = async (
        topmostFirst: string[],
        orderRandomly: boolean
    ): Promise<void> => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await submitChoice({
                gameId,
                playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                cardInstanceIds: topmostFirst,
                ...(orderRandomly ? { orderRandomly: true } : {}),
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <LibraryOrderPicker
            // Keyed by the choice: two owners' batches back to back must not
            // share one instance's drag order.
            key={head.choiceId}
            lookedAt={cards}
            destination="none"
            prompt={
                head.prompt ??
                "Arrange the cards put into your graveyard (rightmost = top)."
            }
            submitting={submitting}
            graveyardOrder={{ onOrderRandomly: () => void submit([], true) }}
            onConfirm={(topmostFirst) => void submit(topmostFirst, false)}
        />
    );
}
