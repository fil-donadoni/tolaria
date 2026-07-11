import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { isSelectableHandChoiceCard } from "~/lib/hand-choice";
import { isSeenByOpponent } from "~/lib/hand-knowledge";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { useDragToCommit } from "~/hooks/useDragToCommit";
import { buildTriggerStateView, getHandStackAbilities } from "~/lib/card-utils";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";
import SeenByOpponentBadge from "./seen-by-opponent-badge";
import HandCardActionMenu, {
    type HandCardPrimaryAction,
} from "./hand-card-action-menu";

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
    /** Horizontal lift (px) for the dragged card given the live pointer x, so its
     *  center tracks the pointer even as its own slot reorders under it, bounded
     *  to the hand span. Supplied by the hand (which owns the slot geometry).
     *  When omitted the card falls back to the raw pointer offset. */
    dragTranslateX?: (pointerX: number) => number;
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
    dragTranslateX,
}: BoardHandCardProps) {
    const {
        gameId,
        playerId,
        pendingChoices,
        phase,
        activePlayerId,
        allPlayers,
        priorityPlayerId,
        pendingCast,
        pendingActivation,
        pendingTarget,
    } = useGameContext();
    const activateAbility = useMutation(api.game.activateAbility);
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

    // CR 702.29a — Cycling (and any future hand-activated ability). A card in
    // the viewer's own hand can activate its hand ability when the viewer holds
    // priority with no other interaction pending (so the affordance can't
    // collide with a cast/target/payment in flight). The list is computed from
    // the bundled card def, exactly like the graveyard/battlefield paths; the
    // server (`activateAbility`) is authoritative. Suppressed during a
    // hand-choice (handled by the early return below, which never reaches this
    // render).
    const hasPriority = priorityPlayerId === playerId;
    const noPendingInteraction =
        !pendingCast && !pendingActivation && !pendingTarget;
    const handAbilities =
        hasPriority && noPendingInteraction && !isHandChoice
            ? getHandStackAbilities(
                  card,
                  phase,
                  buildTriggerStateView(allPlayers, activePlayerId)
              )
            : [];

    const {
        onPlayClick,
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
        costDialogOverlay,
    } = useHandCardCommit(card);

    const commit = (e: React.MouseEvent | React.PointerEvent) => {
        // Land plays take precedence over cast for the same instance; only one
        // of the two is legal for a hand card in practice.
        if (canPlay) onPlayClick();
        else if (canCast) onCastClick(e);
    };

    // Left-click affordance model (the user's requested UX):
    //  - the card's options are its hand abilities (Cycling) + its primary
    //    play/cast action when currently legal;
    //  - MORE THAN ONE option → a left click opens a menu (desktop context
    //    menu / mobile action-sheet) listing every option, so a low hand row
    //    can never hide an option off-screen (the old bottom-anchored button
    //    was clipped below the viewport);
    //  - EXACTLY ONE option → the left click performs it directly (a normal
    //    spell casts as before; a Cycling-only card — e.g. Miscalculation with
    //    no legal cast at an empty stack — cycles);
    //  - drag always commits the primary play/cast (unchanged).
    const activateHandAbility = (abilityId: string, keepPriority: boolean) => {
        void activateAbility({
            gameId,
            playerId,
            cardInstanceId: card.id,
            abilityId,
            ...(keepPriority ? { keepPriority: true } : {}),
        }).catch((err) => console.error(extractMutationErrorMessage(err)));
    };
    const primaryAvailable = canPlay || canCast;
    const optionCount = handAbilities.length + (primaryAvailable ? 1 : 0);
    const useMenu = !isHandChoice && optionCount > 1;
    const cyclingOnlyClick =
        !useMenu && handAbilities.length === 1 && !primaryAvailable;
    const primaryAction: HandCardPrimaryAction | undefined = canPlay
        ? { label: "Play land", onSelect: () => onPlayClick() }
        : canCast
          ? {
                label: "Cast",
                onSelect: (e) => onCastClick(e as React.MouseEvent),
            }
          : undefined;

    // Touch-vs-desktop tap detection for the menu (mirrors
    // `useAbilityCardClick` on the battlefield): touchstart flags the next
    // click as a tap so it opens the action-sheet, while a desktop left click
    // falls through to the ContextMenuTrigger which synthesizes the menu.
    const [sheetOpen, setSheetOpen] = useState(false);
    const isTouchRef = useRef(false);

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

    // The dragged card's center tracks the pointer via the hand-supplied lift
    // (which cancels the reorder-induced slot shift and clamps to the hand span),
    // so it stays under the finger and can never fly out of the viewport. Falls
    // back to the raw pointer offset when the hand supplies no geometry.
    const liftX =
        state.dragging && dragTranslateX && state.pointerX !== null
            ? dragTranslateX(state.pointerX)
            : state.offset.x;
    const lift = state.dragging
        ? `translate(${liftX}px, ${state.offset.y}px) scale(1.06)`
        : undefined;

    // Non-drag left click. With a menu, a desktop click falls through to the
    // ContextMenuTrigger (opens the menu) and a touch tap opens the action-sheet;
    // with a single option the click performs it directly (cycling-only card, or
    // the normal play/cast commit).
    const onRootClick = (e: React.MouseEvent) => {
        if (useMenu) {
            if (isTouchRef.current) {
                isTouchRef.current = false;
                e.preventDefault();
                e.stopPropagation();
                setSheetOpen(true);
            }
            return;
        }
        if (cyclingOnlyClick) {
            activateHandAbility(handAbilities[0].id, e.ctrlKey || e.metaKey);
            return;
        }
        if (commitEnabled) commit(e);
    };

    const cardEl = (
        <div
            data-board-hand-card={card.id}
            data-drag-armed={state.armed ? "true" : undefined}
            className={
                optionCount > 0 ? "cursor-pointer touch-none" : "touch-none"
            }
            onClick={onRootClick}
            onTouchStart={
                useMenu
                    ? () => {
                          isTouchRef.current = true;
                      }
                    : undefined
            }
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
            {altCostPickerOverlay}
            {costDialogOverlay}
        </div>
    );

    // A card with two or more options (Cycling + a legal play/cast) wraps its
    // clickable element in the action menu; a card with one option keeps the
    // direct click-to-act behaviour (no one-item menu).
    if (!useMenu) return cardEl;
    return (
        <HandCardActionMenu
            abilities={handAbilities}
            onActivate={activateHandAbility}
            primaryAction={primaryAction}
            sheetOpen={sheetOpen}
            onSheetClose={() => setSheetOpen(false)}
        >
            {cardEl}
        </HandCardActionMenu>
    );
}
