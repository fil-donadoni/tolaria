import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import LibraryOrderPicker from "./library-order/library-order-picker";

/** Full-screen picker for a `choose-hand-card` choice flagged `putOnTop` — the
 *  chooser puts N cards from their OWN hand on TOP of their library in chosen
 *  order (Brainstorm's `putBack` Op, CR 401.4). Mirrors `HandCardPick`'s mount
 *  (own hand read from `useGameContext`), but drives the ordered HAND→TOP drag
 *  surface (`LibraryOrderPicker` `putBack` mode) instead of the flat grid — the
 *  ORDER is authoritative here, so this never routes through the toggle buffer.
 *
 *  Gates on the flag + own hand (`playerId` is the chooser and owns the zone).
 *  A plain own-hand discard (`choose-hand-card` without `putOnTop`) keeps the
 *  in-hand toggle; this component ignores it. */
export default function PutBackPicker() {
    const { gameId, playerId, allPlayers, pendingChoices } = useGameContext();
    const submitChoice = useMutation(api.game.submitResolutionChoice);
    const [submitting, setSubmitting] = useState(false);

    const head = pendingChoices?.[0];
    const active =
        !!head &&
        head.kind === "choose-hand-card" &&
        !!head.putOnTop &&
        head.playerId === playerId &&
        (head.zoneOwnerId ?? head.playerId) === playerId;

    if (!active) return null;

    const owner = allPlayers.find((p) => p.id === playerId);
    // Own hand crosses the wire with identity (only the opponent's is nulled), so
    // every slot is a real card here.
    const cards = (owner?.hand ?? []).filter(
        (c): c is CardInstance => c !== null
    );
    const keep = typeof head.count === "number" ? head.count : head.count.min;

    const handleConfirm = async (topTopmostFirst: string[]) => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await submitChoice({
                gameId,
                playerId,
                stackItemId: head.stackItemId,
                step: head.step,
                choiceId: head.choiceId,
                // The picker yields the top order TOPMOST-FIRST, but the engine
                // replays the picks through `moveHandCardToLibraryTop`, which
                // UNSHIFTS each — so the LAST id submitted ends up on top. Reverse
                // to bottommost-first so the chooser's visual top actually lands
                // on top (CR 401.4 "in any order").
                cardInstanceIds: [...topTopmostFirst].reverse(),
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <LibraryOrderPicker
            lookedAt={cards.map((c) => ({
                instanceId: c.id,
                defId: c.card.id,
            }))}
            destination="none"
            prompt={
                head.prompt ??
                "Put cards on top of your library (topmost first)"
            }
            submitting={submitting}
            putBack={{ keep }}
            onConfirm={handleConfirm}
        />
    );
}
