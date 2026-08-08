import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardInstance } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { useAbilityCardClick } from "~/hooks/useAbilityCardClick";
import { isSelectableHandChoiceCard } from "~/lib/hand-choice";
import { isSeenByOpponent } from "~/lib/hand-knowledge";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { useDragToCommit } from "~/hooks/useDragToCommit";
import { useTapStageConfirm } from "~/hooks/useTapStageConfirm";
import { usePendingGameIntent } from "~/hooks/usePendingGameIntent";
import { buildTriggerStateView, getHandStackAbilities } from "~/lib/card-utils";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import {
    hasPendingGameIntent,
    trackGameIntent,
} from "~/lib/pending-intent-store";
import { LIFTED_CARD_Z } from "~/lib/board-motion";
import { useManualHandInteraction } from "~/lib/manual-card-verbs";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";
import SeenByOpponentBadge from "./seen-by-opponent-badge";
import ActivatableAbilityMenu from "./activatable-ability-menu";
import type { ActivatableAbility } from "./battlefield-card";
import HandCardActionMenu, {
    type HandCardPrimaryAction,
} from "./hand-card-action-menu";
import HandCardConfirmPill from "./hand-card-confirm-pill";

/** Stable empty list so a GRE-board render (no manual provider) never
 *  allocates a fresh array for `useAbilityCardClick`'s dependency array
 *  (issue #2347 — see {@link useManualHandInteraction} for the seam this
 *  serves). */
const NO_MANUAL_ABILITIES: ActivatableAbility[] = [];

/** Upward travel (px) of a card STAGED by a touch tap (#1767) — the same
 *  "lifting out of the hand" read as the drag gesture, at a rest offset. */
const STAGED_LIFT_PX = 18;

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
    /** `sizes` hint forwarded to CardImage — defaults to the landscape hand's
     *  120px slot; the portrait hand passes its 76px. */
    sizes?: string;
    /** Forwarded to CardImage. The landscape hand (120px) is a mid slot, so it
     *  excludes `thumb` (default false); the portrait hand (76px) keeps it. */
    includeThumb?: boolean;
    /** Called whenever this card's touch STAGE (#1767) opens or closes, so the
     *  hand can raise the card's whole SLOT above its neighbours. The card's own
     *  inner `zIndex` is enough for the portrait row (plain flow siblings), but
     *  NOT for the spatial fan: the slot's DOM node never reorders (the same
     *  reason the dragged slot needs `snap`), so an inner z-index can't lift it
     *  over later-painted siblings — only the slot can. Omitted by hands that
     *  don't stack their cards. */
    onStagedChange?: (staged: boolean) => void;
    /** The card's root disables all native touch gestures (`touch-action:
     *  none`) by default so a touch swipe never scrolls/zooms the page
     *  instead of driving the drag-to-cast gesture. The spatial (landscape)
     *  hand relies on that: it has no scrollable ancestor, and horizontal
     *  pointer movement there drives the JS drag-reorder, not a native pan.
     *  The portrait hand (#336) is DIFFERENT: above the scroll threshold its
     *  row is `overflow-x-auto`, and a touch swipe over a card is the ONLY
     *  way to reach cards past the right edge — but `touch-action: none`
     *  starting on a card blocks the browser from ever recognizing that swipe
     *  as a native scroll, regardless of any JS `preventDefault` (issue
     *  #1994: "10-12 cards in hand on mobile, can't reach the ones past the
     *  right edge"). Set `true` there: `touch-action: pan-x` still lets the
     *  vertical drag-to-cast gesture reach JS (native Y panning is disabled),
     *  while a horizontal swipe is handed to the browser's own scroll.
     *  Omitted ⇒ `touch-none` (unchanged spatial-hand behavior). */
    allowHorizontalPan?: boolean;
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
    sizes = "120px",
    includeThumb = false,
    onStagedChange,
    allowHorizontalPan = false,
}: BoardHandCardProps) {
    const {
        gameId,
        playerId,
        pendingChoices,
        phase,
        turn,
        stackCount,
        activePlayerId,
        allPlayers,
        priorityPlayerId,
        pendingCast,
        pendingActivation,
        pendingTarget,
        cannotActivateAbilitiesThisTurn,
    } = useGameContext();
    const activateAbility = useMutation(api.game.activateAbility);
    const bufferCtx = usePendingChoiceBuffer();

    // Issue #2347 — present only under `ManualHandInteractionProvider`
    // (`manual-board-view.tsx`). Computed unconditionally, alongside every
    // other hook here, so the manual branch below stays a plain `if` after
    // the hooks rather than a conditional hook call; when absent (every GRE
    // board) `manualAbilities` is always the empty list and the click/touch
    // handlers below are simply never wired to the DOM.
    const manualInteraction = useManualHandInteraction();
    const manualAbilities = manualInteraction
        ? manualInteraction.getVerbs(card.id)
        : NO_MANUAL_ABILITIES;
    const manualActivate = (abilityId: string, keepPriority: boolean) => {
        // Hand verbs never pay a cost — `keepPriority` only exists to match
        // `useAbilityCardClick`'s shared contract with the battlefield card.
        void keepPriority;
        manualInteraction?.activate(card.id, abilityId);
    };
    const manualAbilityClick = useAbilityCardClick(
        manualAbilities,
        manualActivate
    );

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

    // The commit gesture (drag-to-cast / swipe on mobile, and the tap-stage
    // confirm) must obey the SAME window the hand abilities above do. Server
    // `legalActions` already drops `cast`/`play` while an interaction is
    // pending (`getLegalActions`, ADR 0047), but the client owns the
    // round-trip: between the first swipe's `announceCast` and the payment
    // banner arriving the projection still says "cast", and a second swipe
    // there dispatched a doomed cast the player saw only as a raw "Server
    // Error". `intentInFlight` closes exactly that window — the same store the
    // Space hotkey uses to refuse falling through to `passPriority`.
    const intentInFlight = usePendingGameIntent();
    const commitEnabled =
        !isHandChoice &&
        (canPlay || canCast) &&
        hasPriority &&
        noPendingInteraction &&
        !intentInFlight;

    const handAbilities =
        hasPriority && noPendingInteraction && !isHandChoice
            ? getHandStackAbilities(
                  card,
                  phase,
                  buildTriggerStateView(
                      allPlayers,
                      activePlayerId,
                      cannotActivateAbilitiesThisTurn
                  )
              )
            : [];

    const {
        onPlayClick,
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
        phyrexianPickerOverlay,
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
        // Same in-flight drop as the cast/play commit: a double tap inside the
        // round trip would hit "Another ability is already being activated".
        if (hasPendingGameIntent()) return;
        void trackGameIntent(
            activateAbility({
                gameId,
                playerId,
                cardInstanceId: card.id,
                abilityId,
                ...(keepPriority ? { keepPriority: true } : {}),
            })
        ).catch((err) => console.error(extractMutationErrorMessage(err)));
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

    // Touch tap = stage + confirm (issue #1767). A touch tap on a card whose
    // single option is its play/cast NO LONGER dispatches immediately: the first
    // tap stages the card (lift + confirm pill), the second tap — on the card or
    // on the pill — commits, and a tap anywhere else cancels. Mouse and pen are
    // untouched (`consumeClick` returns false on the first call for them), and
    // the multi-option path is untouched too: it already interposes the
    // action-sheet, which is the same confirmation step by another shape.
    //
    // `resetKey` is the digest of everything the staged action depends on: the
    // stage is optimistic client state over a card the server can move at any
    // moment, so a priority / phase / turn / zone / legality / stack change
    // drops it rather than leaving a card lifted over an action that is no
    // longer the one the player staged. (A card that LEAVES the hand unmounts
    // this component outright, which drops the stage with it.)
    const stageRootRef = useRef<HTMLDivElement>(null);
    const tapStage = useTapStageConfirm({
        enabled: commitEnabled,
        rootRef: stageRootRef,
        resetKey: [
            turn,
            phase,
            priorityPlayerId,
            activePlayerId,
            stackCount,
            card.zone,
            legal.join("+"),
            pendingCast ? "c" : "",
            pendingActivation ? "a" : "",
            pendingTarget ? "t" : "",
        ].join("|"),
    });

    // A drag is a different gesture with its own commit — it must never leave a
    // stage standing behind it (or commit twice).
    const unstage = tapStage.unstage;
    useEffect(() => {
        if (state.dragging) unstage();
    }, [state.dragging, unstage]);

    // Report the stage upward so the hand can raise this card's whole SLOT (see
    // `onStagedChange`). The cleanup also fires when the card unmounts while
    // staged (it was played — it leaves the hand), so the raise is never left
    // pinned to a card that is gone.
    const staged = tapStage.staged;
    useEffect(() => {
        if (!onStagedChange) return;
        onStagedChange(staged);
        return () => {
            if (staged) onStagedChange(false);
        };
    }, [staged, onStagedChange]);

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

    // Manual Board variant (issue #2347). Rendered AFTER every hook above
    // runs, exactly like the choice-toggle branch below — every GRE hook
    // still ran this render, but NONE of its handlers are spread onto this
    // markup, so the cast/play pipeline never fires. The root binds NO
    // pointer handlers of its own (unlike the GRE branch's `useDragToCommit`
    // wiring below): a manual hand card's drag is the board-level
    // `useManualDrag` gesture bound on `<main>` (`manual-board-view.tsx`),
    // which hit-tests this same `data-board-hand-card` attribute — this
    // branch only has to keep carrying it, never intercept the pointerdown
    // that gesture bubbles up to. Click/touch are the ONE gesture this
    // branch owns, via the same `ActivatableAbilityMenu` +
    // `useAbilityCardClick` pair the battlefield permanents already ride
    // (`battlefield-card.tsx`).
    if (manualInteraction) {
        return (
            <ActivatableAbilityMenu
                abilities={manualAbilities}
                onActivate={manualActivate}
                sheetOpen={manualAbilityClick.sheetOpen}
                onSheetClose={manualAbilityClick.onSheetClose}
            >
                <div
                    data-board-hand-card={card.id}
                    className={
                        manualAbilities.length > 0 ? "cursor-pointer" : ""
                    }
                    onClick={manualAbilityClick.onClick}
                    onTouchStart={manualAbilityClick.onTouchStart}
                >
                    <CardImage
                        card={card}
                        sizes={sizes}
                        includeThumb={includeThumb}
                    />
                    {seen && <SeenByOpponentBadge />}
                </div>
            </ActivatableAbilityMenu>
        );
    }

    // Choice-toggle variant (CR 608.2). Rendered AFTER every hook above runs so
    // the rules-of-hooks contract holds; the drag pipeline is already inert
    // (`commitEnabled` is false during a hand choice) so the card never casts.
    // A click toggles the buffer; the ring mirrors `selectable-card`
    // (emerald = picked, violet = pickable). Hover-zoom still rides along via
    // the mounted CardImage. Keyed by the same `data-board-hand-card` handle so
    // tests / arrows find the card on either path.
    if (isHandChoice) {
        const ringClass = isChoiceSelected
            ? "ring-2 ring-signal-self"
            : "ring-2 ring-signal-target/60 cursor-pointer hover:ring-signal-target-strong";
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
                <CardImage
                    card={card}
                    sizes={sizes}
                    includeThumb={includeThumb}
                />
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
    // A staged card lifts out of the fan the same way a dragged one does — the
    // gesture is "this card is about to be played", so it reads as the same
    // motion. Drag wins while it is running (the two are never simultaneous in
    // practice: a drag un-stages).
    const lift = state.dragging
        ? `translate(${liftX}px, ${state.offset.y}px) scale(1.06)`
        : tapStage.staged
          ? `translate(0px, -${STAGED_LIFT_PX}px) scale(1.06)`
          : undefined;

    // Non-drag left click. With a menu, a desktop click falls through to the
    // ContextMenuTrigger (opens the menu) and a touch tap opens the action-sheet;
    // with a single option the click performs it directly (cycling-only card, or
    // the normal play/cast commit).
    const onRootClick = (e: React.MouseEvent) => {
        // Every overlay this card opens — the cost dialog (X / kicker /
        // buyback), the mode / alt-cost / Phyrexian pickers, the confirm pill —
        // is a PORTAL: outside the card in the DOM, but still a CHILD of it in
        // the React tree, so React bubbles its clicks straight back into this
        // handler. A click on one of them is never this card's click. Letting it
        // through re-entered the commit path after a cast-with-dialog and, on
        // touch, RE-STAGED the card that had just been cast (`consumeClick`
        // sees the touch pointer type left by the tap) — a stray floating
        // "Cast" pill over a card no longer in hand, whose tap fired a SECOND
        // commit. The same guard the drag pipeline already applies to its
        // click-swallow (`useDragToCommit.onClickCapture`): only a click
        // PHYSICALLY inside the card counts.
        if (!e.currentTarget.contains(e.target as Node)) return;
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
        if (!commitEnabled) return;
        // Touch: the first tap only stages (#1767). Mouse/pen, and the second
        // tap on an already-staged card, fall straight through to the commit.
        if (tapStage.consumeClick()) return;
        commit(e);
    };

    const cardEl = (
        <div
            ref={stageRootRef}
            data-board-hand-card={card.id}
            data-drag-armed={state.armed ? "true" : undefined}
            data-tap-staged={tapStage.staged ? "true" : undefined}
            className={
                (optionCount > 0 ? "cursor-pointer " : "") +
                (allowHorizontalPan ? "touch-pan-x" : "touch-none")
            }
            onClick={onRootClick}
            onTouchStart={
                useMenu
                    ? () => {
                          isTouchRef.current = true;
                      }
                    : undefined
            }
            onPointerDown={(e) => {
                tapStage.onPointerDown(e);
                handlers.onPointerDown(e);
            }}
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
                // A LIFTED card (dragged, or staged by a touch tap) paints over
                // its neighbours — the hand overlaps its cards, so without the
                // raise the confirming second tap lands on the neighbour that
                // covers a third of the staged card (#1767 review). This inner
                // raise carries the portrait row (plain flow siblings); the
                // spatial fan's slot is raised by the hand via `onStagedChange`.
                zIndex: state.dragging || staged ? LIFTED_CARD_Z : undefined,
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
                    <CardImage
                        card={card}
                        sizes={sizes}
                        includeThumb={includeThumb}
                    />
                </div>
            </CardTilt3D>
            {seen && <SeenByOpponentBadge />}
            {tapStage.staged && (
                <HandCardConfirmPill
                    anchorRef={stageRootRef}
                    label={canPlay ? "Play" : "Cast"}
                    onConfirm={(e) => {
                        unstage();
                        commit(e);
                    }}
                />
            )}
            {modePickerOverlay}
            {altCostPickerOverlay}
            {phyrexianPickerOverlay}
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
