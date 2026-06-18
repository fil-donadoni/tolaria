import type { CardInstance } from "~/types/game";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { useDragToCommit } from "~/hooks/useDragToCommit";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";

type BoardNextHandCardProps = {
    /** The viewer's own hand card (never null — opponent/back slots render the
     *  presentational {@link BoardNextCard} instead). */
    card: CardInstance;
};

/** Interactive hand card for the spatial board (PRD #249, slice #254).
 *
 * Adds drag-to-cast / play-land on top of the presentational board card without
 * touching the GRE boundary. Click and drag share ONE commit pipeline
 * ({@link useHandCardCommit}): clicking, or dragging the card above the commit
 * line and releasing, dispatches the SAME mutation (`playCard` for a land,
 * `announceCast` for a spell) with the SAME arguments — so the X prompt, mode
 * picker and all downstream flow (payment banner, targeting) are identical for
 * both gestures. Releasing below the line returns the card to the hand and
 * dispatches nothing.
 *
 * Which commit fires is chosen from the card's `legalActions`: a legal `play`
 * (land) plays it, otherwise a legal `cast` casts it. When neither is legal the
 * card is inert — drag still returns to hand, click does nothing.
 *
 * Drag is a distinct gesture from the hover tilt (#253): once a drag starts the
 * tilt is suppressed (the card lifts as a flat rigid object toward the cursor)
 * so the two effects never fight. The outer slot placement / spring FLIP (#252)
 * are untouched — the lift is applied to an inner wrapper. */
export default function BoardNextHandCard({ card }: BoardNextHandCardProps) {
    const legal = card.legalActions ?? [];
    const canPlay = legal.includes("play");
    const canCast = legal.includes("cast");
    const commitEnabled = canPlay || canCast;

    const { onPlayClick, onCastClick, modePickerOverlay } =
        useHandCardCommit(card);

    const commit = (e: React.MouseEvent | React.PointerEvent) => {
        // Land plays take precedence over cast for the same instance; only one
        // of the two is legal for a hand card in practice.
        if (canPlay) onPlayClick();
        else if (canCast) onCastClick(e);
    };

    const { state, handlers } = useDragToCommit({
        commitEnabled,
        onCommit: commit,
    });

    const lift = state.dragging
        ? `translate(${state.offset.x}px, ${state.offset.y}px) scale(1.06)`
        : undefined;

    return (
        <div
            data-board-hand-card={card.id}
            data-drag-armed={state.armed ? "true" : undefined}
            className={
                commitEnabled ? "cursor-pointer touch-none" : "touch-none"
            }
            onClick={commitEnabled ? commit : undefined}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
            onClickCapture={handlers.onClickCapture}
            style={{
                // While dragging the card follows the cursor as a rigid lifted
                // object; the hover tilt is suppressed (no CardTilt3D) so the
                // two gestures don't compose into a jitter.
                transform: lift,
                transition: state.dragging
                    ? "none"
                    : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                zIndex: state.dragging ? 50 : undefined,
                position: "relative",
            }}
        >
            {state.dragging ? (
                <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
                    <CardImage card={card} />
                </div>
            ) : (
                <CardTilt3D>
                    <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-[0_6px_16px_rgba(0,0,0,0.55)]">
                        <CardImage card={card} />
                    </div>
                </CardTilt3D>
            )}
            {modePickerOverlay}
        </div>
    );
}
