import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { usePendingChoiceBuffer } from "~/hooks/usePendingChoiceBuffer";
import { isSelectableHandChoiceCard } from "~/lib/hand-choice";
import { isSeenByOpponent } from "~/lib/hand-knowledge";
import { useHandCardCommit } from "~/hooks/useHandCardCommit";
import { useDragToCommit } from "~/hooks/useDragToCommit";
import { useTapStageConfirm } from "~/hooks/useTapStageConfirm";
import { usePendingGameIntent } from "~/hooks/usePendingGameIntent";
import { buildTriggerStateView, getHandStackAbilities } from "~/lib/card-utils";
import {
    landPlayFaces,
    playLandFaceDefinition,
} from "@convex/gre/modalLandPlay";
import { isModalDoubleFaced } from "@convex/cards/modalDfc";
import { tryGetDefinition } from "@convex/cards";
import type { CardInstanceState } from "@convex/gre/state";
import type { PlayLandFace } from "@convex/cards/modalDfc";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import {
    hasPendingGameIntent,
    trackGameIntent,
} from "~/lib/pending-intent-store";
import { LIFTED_CARD_Z } from "~/lib/board-motion";
import CardImage from "../cards/card-image";
import CardTilt3D from "./card-tilt-3d";
import SeenByOpponentBadge from "./seen-by-opponent-badge";
import HandCardActionMenu, {
    type HandCardPrimaryAction,
} from "./hand-card-action-menu";
import HandCardConfirmPill from "./hand-card-confirm-pill";
import type { BoardHandCardProps } from "./board-hand-card";
import { cardRingClass } from "~/lib/card-ring";

/** Upward travel (px) of a card STAGED by a touch tap (#1767) — the same
 *  "lifting out of the hand" read as the drag gesture, at a rest offset. */
const STAGED_LIFT_PX = 18;

/** GRE hand card for the spatial board (PRD #249, slice #254; UX fixes #271).
 *
 * Split out of `BoardHandCard` on the PR #2359 review — a BLOCKING finding
 * (issue #2347): `BoardHandCard` used to be ONE function that called every
 * GRE hook below unconditionally and then, late in its body, branched to a
 * Manual Board variant. `useHandCardCommit` is not pure — it reads a
 * `CardDefinition` unconditionally — and a Manual Game's hand card ids are
 * Full Catalogue print ids the registry doesn't know (ADR 0080), so any
 * Tabletop hand holding an unimplemented card crashed on render. Skipping
 * these hooks with an early return INSIDE that one function is a real
 * `react-hooks/rules-of-hooks` violation regardless of how stable the branch
 * is (ESLint has no way to know the manual/GRE split can never flip within
 * one mounted instance) — so the fix has to be a genuine component split,
 * not a conditional return before a hook call. `BoardHandCard` is now a thin
 * dispatcher (its own file) that calls exactly one hook
 * (`useManualCardInteraction`) and renders either this component or
 * `ManualHandCard` — never both, and never a hook from the other's
 * component tree.
 *
 * This component owns 100% of what `BoardHandCard` used to do: drag-to-cast
 * / play-land on top of the presentational board card without touching the
 * GRE boundary. Click and drag share ONE commit pipeline
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
export default function GreHandCard({
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
        combat,
        continuousEffects,
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
                      cannotActivateAbilitiesThisTurn,
                      undefined,
                      undefined,
                      continuousEffects
                  ),
                  // CR 702.49a — combat, so a ninjutsu ability is offered only
                  // while its return leg is payable (`getHandStackAbilities`
                  // fails closed without it).
                  { combat, players: allPlayers }
              )
            : [];

    const {
        onPlayClick,
        onCastClick,
        modePickerOverlay,
        altCostPickerOverlay,
        phyrexianPickerOverlay,
        additionalCostPickerOverlay,
        costDialogOverlay,
    } = useHandCardCommit(card);

    // The drag / swipe gesture commits the card's ONE primary action. A card
    // offering two (CR 712.12 — a modal card's cast and its land play) has no
    // "the" action for a gesture to mean, so `commitEnabled` below turns the
    // gesture off for it and the menu, which lists both, is the only way in.
    // Guessing one would silently spend a land drop on a player who dragged
    // meaning to cast.
    const commit = (e: React.MouseEvent | React.PointerEvent) => {
        if (canPlay && !canCast) onPlayClick(landFaces[0] ?? "front");
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
    // CR 712.12 / 712.11c (ADR 0122 §2) — a card in hand can offer MORE THAN
    // ONE primary action. A modal double-faced card offers a cast of its front
    // face and a play of its land back face, and the two windows are
    // independent: Sink into Stupor is castable whenever an instant is,
    // Soporific Springs is playable only in a main phase of its controller's
    // turn with an empty stack and a land drop left. Both are read off the
    // SAME shared predicates the server uses — `legalActions` for the window,
    // `landPlayFaces` for which faces are lands (ADR 0074: the client shares
    // the module, never the authority).
    //
    // Ordered cast-then-play so a card whose front face is the marquee half
    // reads that way in the menu; an ordinary land has no cast entry, so its
    // single "Play land" is unchanged.
    // The wire card is a `CardInstanceState` minus its fat `card` payload.
    // WHETHER a land play is legal is the server's answer (`legalActions`,
    // ADR 0074); WHICH faces it may name is the shared predicate's, asked here
    // exactly as `playCard` asks it server-side.
    //
    // When the predicate names no face on a card the server says is playable,
    // the client's own definition data is incomplete — a Manual Board
    // catalogue card (ADR 0080) whose id the registry does not know, a card
    // whose def carries no type line. Offer the FRONT face then, which is what
    // a land play meant before modal cards existed: a dead CTA over an action
    // the server has already declared legal is the worse failure, and the
    // mutation re-derives the face set and refuses anything wrong.
    const instance = card as unknown as CardInstanceState;
    const derivedFaces = canPlay ? landPlayFaces(instance) : [];
    const landFaces: PlayLandFace[] =
        derivedFaces.length > 0 ? derivedFaces : canPlay ? ["front"] : [];
    const isModalCard = isModalDoubleFaced(
        tryGetDefinition(
            (card.card as { id?: string } | undefined)?.id ?? ""
        ) ?? undefined
    );
    const primaryActions: HandCardPrimaryAction[] = [
        ...(canCast
            ? [
                  {
                      label: "Cast",
                      onSelect: (e: React.MouseEvent | React.TouchEvent) =>
                          onCastClick(e as React.MouseEvent),
                  },
              ]
            : []),
        ...landFaces.map((face) => ({
            // An ordinary land keeps the historic "Play land" wording. A
            // MODAL card always names the face, whether or not its front face
            // happens to be castable right now: the card's art and name read
            // "Sink into Stupor", so a row saying "Play land" over it is at
            // its least readable in exactly the case the player most needs
            // told which face enters (PR #3412 review).
            label: isModalCard
                ? `Play ${playLandFaceDefinition(instance, face)?.name ?? "land"}`
                : "Play land",
            onSelect: () => onPlayClick(face),
        })),
    ];
    const primaryAvailable = primaryActions.length > 0;
    const optionCount = handAbilities.length + primaryActions.length;
    const useMenu = !isHandChoice && optionCount > 1;
    const cyclingOnlyClick =
        !useMenu && handAbilities.length === 1 && !primaryAvailable;
    // CR 712.12 — the drag/swipe and tap-stage gestures commit "the" primary
    // action, so they are armed only while there IS one. A modal double-faced
    // card offering both a cast and a land play routes through the menu, which
    // names each face; see `commit` above.
    const gestureEnabled = commitEnabled && primaryActions.length <= 1;

    // Touch-vs-desktop tap detection for the menu (mirrors
    // `useAbilityCardClick` on the battlefield): touchstart flags the next
    // click as a tap so it opens the action-sheet, while a desktop left click
    // falls through to the ContextMenuTrigger which synthesizes the menu.
    const [sheetOpen, setSheetOpen] = useState(false);
    const isTouchRef = useRef(false);

    const { state, handlers } = useDragToCommit({
        commitEnabled: gestureEnabled,
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
        enabled: gestureEnabled,
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

    // Choice-toggle variant (CR 608.2). Rendered AFTER every hook above runs so
    // the rules-of-hooks contract holds; the drag pipeline is already inert
    // (`commitEnabled` is false during a hand choice) so the card never casts.
    // A click toggles the buffer; the ring mirrors `selectable-card`
    // (`selected` = picked, `candidate` = pickable). Hover-zoom rides along via
    // the mounted CardImage. Keyed by the same `data-board-hand-card` handle so
    // tests / arrows find the card on either path.
    if (isHandChoice) {
        const ringClass = isChoiceSelected
            ? cardRingClass("selected")
            : `${cardRingClass("candidate")} cursor-pointer`;
        return (
            <div
                data-board-hand-card={card.id}
                data-choice-selectable="true"
                data-choice-selected={isChoiceSelected ? "true" : undefined}
                className={`relative ${ringClass}`}
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
                        "w-full h-full card-corner overflow-hidden ring-1 ring-black/40 " +
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
            {additionalCostPickerOverlay}
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
            primaryActions={primaryActions}
            sheetOpen={sheetOpen}
            onSheetClose={() => setSheetOpen(false)}
        >
            {cardEl}
        </HandCardActionMenu>
    );
}
