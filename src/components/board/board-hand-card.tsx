import { useEffect, useRef } from "react";
import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { isSelectableHandChoiceCard } from "~/lib/hand-choice";
import { isSeenByOpponent } from "~/lib/hand-knowledge";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { useDragToCommit } from "~/hooks/useDragToCommit";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";
import SeenByOpponentBadge from "./seen-by-opponent-badge";

type BoardHandCardProps = {
    /** The viewer's own hand card (never null — opponent/back slots render the
     *  presentational {@link BoardCard} instead). */
    card: CardInstance;
    /** Called on every drag move with the live pointer x (client px) so the
     *  hand container can reorder the presentation slots under the drop
     *  position (#271, fix 2). Omitted when the hand can't reorder (single
     *  card). */
    onDragMove?: (pointerX: number) => void;
    /** Called once the drag gesture ends (release or cancel) so the hand can
     *  clear its drag-reorder bookkeeping. */
    onDragEnd?: () => void;
};

/** Interactive hand card for the spatial board (PRD #249, slice #254; UX fixes
 *  #271).
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
 * Hover-zoom preview (#271, fix 1) rides along exactly as it does on the
 * battlefield card: {@link CardImage} owns {@link CardPreview}, and it is
 * mounted UNCONDITIONALLY (not swapped out while dragging) so a plain mouse
 * hover always reaches the preview's `mouseenter`. The drag lift is applied to
 * the OUTER wrapper while the same `CardImage` element stays mounted inside the
 * tilt root, so the gesture never tears down the hover vehicle.
 *
 * Drag is a distinct gesture from the hover tilt (#253): once a drag starts the
 * tilt is held flat (the card lifts as a rigid object toward the cursor) so the
 * two effects never fight. The outer slot placement / spring FLIP (#252) are
 * untouched — the lift is applied to an inner wrapper. The rendered upward lift
 * is clamped in {@link useDragToCommit} so the card never escapes into the
 * clipped band above the hand (#271, fix 4). */
export default function BoardHandCard({
    card,
    onDragMove,
    onDragEnd,
}: BoardHandCardProps) {
    const { playerId, pendingChoices } = useGameContext();
    const bufferCtx = usePendingChoiceBuffer();

    // Mid-resolution hand pick (CR 608.2, ADR 0007). When the active choice
    // targets the hand zone and this is one of the viewer's own selectable
    // cards, the card becomes a CHOICE toggle rather than a cast/play source:
    // clicking toggles the local buffer (submitted atomically via the Done
    // button), and the drag-to-cast pipeline is suppressed so the gesture can't
    // announce a spell mid-resolution. Mirrors the classic `selectable-card`
    // hand-choice branch so both boards toggle the SAME buffer.
    const activeChoice = pendingChoices?.[0];
    const isHandChoice = isSelectableHandChoiceCard(
        activeChoice,
        card,
        playerId
    );
    const isChoiceSelected = isHandChoice && bufferCtx.buffer.includes(card.id);

    // ADR 0026 / PRD #338 (slice 3) — the eye badge shows iff an opponent
    // legitimately knows this specific own-hand card. Per-card, never the whole
    // hand. The flag is derived server-side; raw `knownTo` never reaches here.
    const seen = isSeenByOpponent(card);

    const legal = card.legalActions ?? [];
    const canPlay = legal.includes("play");
    const canCast = legal.includes("cast");
    const commitEnabled = !isHandChoice && (canPlay || canCast);

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

    // Drive the hand's drag-reorder from the live pointer x (#271, fix 2): the
    // hand container snaps the dragged card to the slot under the drop position.
    // Notifying via an effect keeps this card a pure consumer of the gesture
    // state and avoids reordering during render.
    const wasDragging = useRef(false);
    useEffect(() => {
        if (state.dragging && state.pointerX !== null) {
            wasDragging.current = true;
            onDragMove?.(state.pointerX);
        } else if (wasDragging.current) {
            wasDragging.current = false;
            onDragEnd?.();
        }
    }, [state.dragging, state.pointerX, onDragMove, onDragEnd]);

    // Choice-toggle variant (CR 608.2). Rendered AFTER every hook above runs so
    // the rules-of-hooks contract holds; the drag pipeline is already inert
    // (`commitEnabled` is false during a hand choice) so the card never casts.
    // A click toggles the buffer; the ring mirrors `selectable-card`
    // (emerald = picked, violet = pickable). Hover-zoom still rides along via
    // the mounted CardImage. Keyed by the same `data-board-hand-card` handle so
    // tests / arrows find the card on either path.
    if (isHandChoice) {
        const ringClass = isChoiceSelected
            ? "ring-2 ring-emerald-400"
            : "ring-2 ring-violet-400/60 cursor-pointer hover:ring-violet-300";
        return (
            <div
                data-board-hand-card={card.id}
                data-choice-selectable="true"
                data-choice-selected={isChoiceSelected ? "true" : undefined}
                className={`relative rounded-md ${ringClass}`}
                onClick={() => {
                    if (activeChoice) bufferCtx.toggle(card.id);
                }}
            >
                <CardImage card={card} />
                {seen && <SeenByOpponentBadge />}
            </div>
        );
    }

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
            onLostPointerCapture={handlers.onLostPointerCapture}
            onClickCapture={handlers.onClickCapture}
            style={{
                // While dragging the card follows the cursor as a rigid lifted
                // object; the hover tilt is held flat (CardTilt3D is kept
                // mounted but the lift overrides it) so the two gestures don't
                // compose into a jitter.
                transform: lift,
                transition: state.dragging
                    ? "none"
                    : "transform 220ms cubic-bezier(0.22, 1, 0.36, 1)",
                zIndex: state.dragging ? 50 : undefined,
                position: "relative",
            }}
        >
            {/* CardImage (which owns the hover-zoom CardPreview) stays mounted
                the whole time — only the drop-shadow strength changes while
                dragging — so a plain hover always reaches the preview (#271,
                fix 1), exactly like the battlefield card. */}
            <CardTilt3D suppressTilt={state.dragging}>
                <div
                    className={
                        "w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 " +
                        (state.dragging
                            ? "shadow-[0_18px_40px_rgba(0,0,0,0.6)]"
                            : "shadow-[0_6px_16px_rgba(0,0,0,0.55)]")
                    }
                >
                    <CardImage card={card} />
                </div>
            </CardTilt3D>
            {seen && <SeenByOpponentBadge />}
            {modePickerOverlay}
        </div>
    );
}
