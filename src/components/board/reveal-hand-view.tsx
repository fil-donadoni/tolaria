import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import CardsPile from "./cards-pile";

/** Modal viewer for a `reveal-hand` look choice (CR 401.4 / 701.18a) — the
 *  private "Look at target player's hand" of Gitaxian Probe / Glasses of Urza.
 *  It reuses the SAME picker surface as `HandCardPick` (Thoughtseize / Duress):
 *  a `CardsPile` grid of the target's hand rendered face-up. It differs in one
 *  way — a private look has NO card selection (count 0), so the cards are inert
 *  and the footer is a single "Done" that acknowledges the look.
 *
 *  The owner's `hand` stays the sparse ADR 0026 shape here (the look grants
 *  knowledge only AFTER the ack, so the hand slots are still null on the wire);
 *  the face-up cards ride the dedicated `revealedHand` projection, which
 *  `projectPublicState` populates only for this chooser. Acknowledging submits
 *  an empty selection (count 0/0) through the shared `usePendingChoiceBuffer`,
 *  exactly as the bot acks a `reveal-hand`. */
export default function RevealHandView() {
    const { playerId, allPlayers, pendingChoices } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();
    const { isMinimized, minimize } = useMinimizedChoice();

    const head = pendingChoices?.[0];
    const zoneOwnerId = head?.zoneOwnerId;
    const active =
        !!head &&
        head.kind === "reveal-hand" &&
        head.zone === "hand" &&
        head.playerId === playerId &&
        !!zoneOwnerId;

    if (!active) return null;

    const owner = allPlayers.find((p) => p.id === zoneOwnerId);
    // The look exposes the whole hand face-up via `revealedHand` (the sparse
    // `hand` slots are still null until the post-ack `markKnown`). Empty hand is
    // legal — the ack must still be reachable, so the pile renders in controlled
    // mode (below) which skips the empty-zone early return.
    const cards: CardInstance[] = owner?.revealedHand ?? [];

    return (
        <CardsPile
            cards={cards}
            isFaceDown={false}
            layout="grid"
            title={head.prompt ?? "Reveal hand"}
            // Controlled + forceOpen: a blocking, undismissable modal that still
            // mounts its dialog for an EMPTY revealed hand (the controlled path
            // bypasses CardsPile's empty-zone early return). Minimizing flips
            // both to collapse to the board indicator without acking.
            open={!isMinimized}
            onOpenChange={() => {}}
            forceOpen={!isMinimized}
            onMinimize={minimize}
            footer={
                <button
                    type="button"
                    disabled={bufferCtx.isPending}
                    onClick={() => bufferCtx.submit()}
                    className="px-4 py-1.5 rounded-sm text-xs font-beleren tracking-wide bg-accent-soft border border-accent text-accent-strong hover:bg-accent-soft/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                >
                    Done
                </button>
            }
        />
    );
}
