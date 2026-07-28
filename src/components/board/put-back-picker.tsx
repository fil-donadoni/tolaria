import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import {
    pendingChoiceMax,
    pendingChoiceMin,
} from "~/lib/pending-choice-confirm";
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
 *  in-hand toggle; this component ignores it.
 *
 *  Two shapes share this mount (issue #1691):
 *   • EXACT — Brainstorm's `putBack` (`count: 2`): exactly 2 go back on top.
 *   • RANGED — Sylvan Library's `rangedTopdeck` (`count: { min, max }`): the
 *     chooser puts BETWEEN `min` and `max` back and pays life for each one
 *     KEPT (CR 118.4), with `min` carrying the CR 119.4 "can't pay life you
 *     don't have" floor the engine computed. Collapsing the range to
 *     `count.min` (the old behavior) pinned the cap at 0 at a healthy life
 *     total, so nothing could ever be dragged onto the library — the pick
 *     rendered with no usable affordance.
 *
 *  `candidateIds` is the engine's eligibility allow-list (Sylvan Library: the
 *  cards drawn THIS TURN, CR 121.1) and is authoritative: only those hand cards
 *  enter the pool, so a card the player already held is never selectable.
 *  Absent (Brainstorm) the whole hand is the pool. */
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
    // every slot is a real card here. `candidateIds` (when the Op pins one)
    // narrows the pool to the eligible cards — Sylvan Library's "cards in your
    // hand drawn this turn" (CR 121.1); the ids survive `projectPublicState`
    // untouched, so the client filters on exactly what the engine will accept.
    const eligibleIds = head.candidateIds
        ? new Set(head.candidateIds)
        : undefined;
    const cards = (owner?.hand ?? []).filter(
        (c): c is CardInstance =>
            c !== null && (!eligibleIds || eligibleIds.has(c.id))
    );
    const keep = pendingChoiceMax(head.count);
    const min = pendingChoiceMin(head.count);

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
            putBack={{ keep, min }}
            onConfirm={handleConfirm}
        />
    );
}
