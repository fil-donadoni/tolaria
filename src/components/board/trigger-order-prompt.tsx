import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Minus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice, StackItem } from "~/types/game";
import { getStackAbilityOracleText } from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { useViewportWidth } from "~/hooks/useViewportWidth";
import { fitTileWidth, modalChromePaddingX } from "~/lib/reorder-strip-width";
import { SLOT_SPRING } from "~/lib/board-motion";
import StackAbilityTile from "./stack-ability-tile";

/** CR 603.3b (ADR 0058) — the simultaneous-trigger ordering picker. The chooser
 *  controls two or more triggered abilities that triggered from the same event
 *  and orders them on the stack.
 *
 *  This is NOT the library/scry strip: there is no library, no card fan, and —
 *  critically — the candidates are frequently the SAME printed card (two evoked
 *  Griefs, a board wipe hitting three identical tokens), so card ART cannot tell
 *  one trigger apart from another. Each candidate is rendered exactly as it will
 *  look once placed — a `StackAbilityTile` showing the ABILITY's oracle text
 *  (CR 603 — the object on the stack is the ability, not the source). The player
 *  drags the tiles left/right to sequence them; rightmost = TOP OF STACK =
 *  resolves first.
 *
 *  `choice.candidateIds` is the chooser's slice in bottom-first (collection)
 *  order and any permutation is legal, so it seeds `order` (left→right) as-is.
 *  On confirm the strip submits the ordering topmost-first (index 0 = resolves
 *  first) as `cardInstanceIds`, exactly what `applyPendingChoiceSubmit` expects.
 *  Each candidate's `triggeredAbilityId` / `grantedTriggeredAbilities` come from
 *  the projected off-stack `pendingTriggerBatch` (CR 603.3b — the triggers are
 *  public). */

/** Natural (desktop) tile width. Shrunk responsively (issue #1765, shared
 *  `fitTileWidth`) to fit a narrow phone viewport, floored at MIN_TILE_W.
 *  Exported (review fix, issue #1765) so tests import the REAL constants
 *  instead of re-declaring the same literals — a re-declared copy can drift
 *  from this file silently. */
export const NATURAL_TILE_W = 152;
/** Readability floor for the responsive fit — below it the strip's own
 *  horizontal scroll (`overflow-x-auto`, already in place) takes over instead
 *  of shrinking the tile further. */
export const MIN_TILE_W = 96;
export const GAP = 20;
const LIFT = 18;
const DRAG_START_PX = 6;
// StackAbilityTile is an art-crop (ART_CROP_RATIO) plus a two/three-line oracle
// footer; this fixed height comfortably clears the tallest footer down to
// MIN_TILE_W (issue #1765 — the responsive floor is close enough to
// NATURAL_TILE_W, ~63%, that the footer still wraps within this budget).
const STRIP_H = 260;

const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

type Drag = {
    id: string;
    /** Live strip-local pointer x. */
    pointerX: number;
    /** pointer − tile center at grab time, so the tile tracks the pointer 1:1. */
    grabOffsetX: number;
};

export default function TriggerOrderPrompt({
    choice,
    gameId,
}: {
    choice: PendingChoice;
    gameId: Id<"games">;
}) {
    const { pendingTriggerBatch } = useGameContext();
    const submitResolutionChoice = useMutation(api.game.submitResolutionChoice);
    const [submitting, setSubmitting] = useState(false);
    // Issue #315 — collapse this full-screen picker to the board indicator so
    // the chooser can inspect the battlefield mid-order, then restore.
    const { isMinimized, minimize } = useMinimizedChoice();

    const batchById = useMemo(
        () =>
            new Map<string, StackItem>(
                (pendingTriggerBatch ?? []).map((t) => [t.id, t])
            ),
        [pendingTriggerBatch]
    );
    const candidateIds = useMemo(
        () => choice.candidateIds ?? [],
        [choice.candidateIds]
    );

    // Committed order, LEFT→RIGHT; rightmost = TOP OF STACK = resolves first.
    const [order, setOrder] = useState<string[]>(() => [...candidateIds]);
    const [drag, setDrag] = useState<Drag | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const press = useRef<{
        id: string;
        pointerId: number;
        startX: number;
        startY: number;
        grabOffsetX: number;
        active: boolean;
    } | null>(null);

    const localX = useCallback((clientX: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        return clientX - (rect?.left ?? 0);
    }, []);

    // Responsive tile width (issue #1765): a 5+ tile ordering strip at the
    // natural width overflows a 390px phone viewport. Shrink the tile width
    // so the strip's footprint fits the live viewport, floored at
    // MIN_TILE_W — below the floor the strip stops shrinking and its own
    // horizontal scroll (`overflow-x-auto`, below) is the fallback instead.
    // `stripWidthAt` is the same `order.length * (w + GAP) - GAP` the render
    // below uses, just parametrized on `w` — no hardcoded pixel width lives
    // in the gesture math.
    const viewportW = useViewportWidth();
    const tileW = useMemo(
        () =>
            fitTileWidth({
                stripWidthAt: (w) => order.length * (w + GAP) - GAP,
                naturalTileW: NATURAL_TILE_W,
                minTileW: MIN_TILE_W,
                // `modalChromePaddingX` (review fix, issue #1765): derives the
                // same padding numbers the `p-2 sm:p-6` / `px-0 sm:px-10`
                // classes below actually render with, instead of a fixed
                // desktop-shaped constant that left a 390px phone with no
                // real room to shrink into.
                availableWidth: viewportW - modalChromePaddingX(viewportW),
            }),
        [order.length, viewportW]
    );
    const slot = tileW + GAP;
    const stripW = order.length * slot - GAP;
    // Stable across renders unless `tileW` itself changes (a resize) — lets
    // `view`/`onPointerDown` below declare it as a normal dependency instead
    // of re-deriving `slot`/`tileW` inline.
    const center = useCallback(
        (i: number) => i * slot + tileW / 2,
        [slot, tileW]
    );

    // ---- Live drop resolution (pure; recomputed each render while dragging) ----
    const view = useMemo(() => {
        if (!drag) {
            const place = new Map<string, number>();
            order.forEach((id, i) => place.set(id, center(i)));
            return { place, dragX: 0, _commit: null as null | number };
        }
        const rest = order.filter((id) => id !== drag.id);
        const draggedCenter = drag.pointerX - drag.grabOffsetX;
        const dropIndex = clamp(
            Math.round((draggedCenter - tileW / 2) / slot),
            0,
            rest.length
        );
        const next = [...rest];
        next.splice(dropIndex, 0, drag.id);
        const place = new Map<string, number>();
        next.forEach((id, i) => place.set(id, center(i)));
        const dragX = clamp(draggedCenter, tileW / 2, stripW - tileW / 2);
        return { place, dragX, _commit: dropIndex };
    }, [drag, order, stripW, tileW, slot, center]);

    // ---- Gesture (deferred commit + pointer capture, mirrors the hand) ----
    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>, id: string) => {
            if (e.button !== 0 || submitting) return;
            const idx = order.indexOf(id);
            press.current = {
                id,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                grabOffsetX: localX(e.clientX) - center(idx),
                active: false,
            };
        },
        [order, center, localX, submitting]
    );

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const p = press.current;
            if (!p) return;
            if (!p.active) {
                if (
                    Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <
                    DRAG_START_PX
                )
                    return;
                p.active = true;
                e.currentTarget.setPointerCapture(p.pointerId);
            }
            setDrag({
                id: p.id,
                pointerX: localX(e.clientX),
                grabOffsetX: p.grabOffsetX,
            });
        },
        [localX]
    );

    const commit = useCallback(() => {
        const p = press.current;
        press.current = null;
        if (!p || !p.active) {
            setDrag(null);
            return;
        }
        const dropIndex = view._commit;
        setDrag(null);
        if (dropIndex == null) return;
        const rest = order.filter((id) => id !== p.id);
        rest.splice(dropIndex, 0, p.id);
        setOrder(rest);
    }, [view, order]);

    const onPointerUp = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (
                press.current &&
                e.currentTarget.hasPointerCapture(press.current.pointerId)
            ) {
                e.currentTarget.releasePointerCapture(press.current.pointerId);
            }
            commit();
        },
        [commit]
    );

    const onLostPointerCapture = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            // Touch-only trap (same as library-order-picker): a touch
            // pointerdown gives the pressed TILE implicit pointer capture, so
            // the first setPointerCapture on the STRIP transfers it — firing
            // `lostpointercapture` on the tile, which bubbles here and used to
            // commit() instantly, killing the drag on its first move. Only the
            // STRIP itself losing capture may commit.
            if (e.target !== e.currentTarget) return;
            if (press.current) commit();
        },
        [commit]
    );

    const handleConfirm = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            // Rightmost = topmost, so reverse the left→right `order` array.
            await submitResolutionChoice({
                gameId,
                playerId: choice.playerId,
                stackItemId: choice.stackItemId,
                step: choice.step,
                choiceId: choice.choiceId,
                cardInstanceIds: [...order].reverse(),
            });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div
            className={`fixed inset-0 z-modal items-center justify-center bg-scrim p-2 sm:p-6 ${
                isMinimized ? "hidden" : "flex"
            }`}
        >
            <div className="flex max-w-full flex-col gap-4">
                <div className="flex items-center justify-end">
                    <button
                        type="button"
                        onClick={minimize}
                        aria-label="Minimize choice dialog"
                        title="Minimize — inspect the battlefield"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-accent bg-accent/10 text-accent hover:bg-accent/20 transition-colors cursor-pointer"
                    >
                        <Minus className="h-4 w-4" />
                    </button>
                </div>
                <p className="text-center text-sm text-muted-foreground">
                    {choice.prompt}
                </p>

                {/* overflow-hidden (not auto): a lifted tile must never spawn a
                    scrollbar. Padding gives the lifted/scaled tile room
                    (shrunk to 0 on mobile, review fix issue #1765 —
                    `modalChromePaddingX` accounts for it). `justify-center-safe`
                    (not `justify-center`, review fix): plain `justify-center`
                    on an overflowing flex child clamps `scrollLeft` at 0,
                    making the LEFT half of the strip permanently unreachable
                    by scroll; `safe center` falls back to `start` alignment
                    when the content overflows, keeping both ends scrollable. */}
                <div className="flex justify-center-safe overflow-x-auto overflow-y-hidden px-0 sm:px-10 py-6">
                    <div
                        ref={containerRef}
                        className="relative shrink-0 touch-none select-none"
                        style={{ width: stripW, height: STRIP_H + LIFT }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onLostPointerCapture={onLostPointerCapture}
                    >
                        {order.map((id) => {
                            const item = batchById.get(id);
                            const cardId = item?.card.id ?? "";
                            // Every ability flavour, not just a card-def
                            // `triggeredAbilityId`: a REFLEXIVE ability waiting
                            // in the same batch (Inti's "When you do, …") is an
                            // inline delayed trigger carrying its text on the
                            // item, and rendered as a blank tile here until the
                            // shared resolver was used (CR 603.3c / ADR 0048).
                            const abilityText = item
                                ? (getStackAbilityOracleText(item) ?? "")
                                : "";
                            const x = view.place.get(id) ?? 0;
                            const isDrag = drag?.id === id;
                            const dx = isDrag ? view.dragX : x;
                            return (
                                <div
                                    key={id}
                                    className={
                                        submitting
                                            ? "absolute"
                                            : "absolute cursor-grab active:cursor-grabbing"
                                    }
                                    onPointerDown={(e) => onPointerDown(e, id)}
                                    style={{
                                        left: 0,
                                        top: LIFT,
                                        width: tileW,
                                        zIndex: isDrag ? 999 : 1,
                                        transform: `translate(${dx - tileW / 2}px, ${
                                            isDrag ? -LIFT : 0
                                        }px) scale(${isDrag ? 1.05 : 1})`,
                                        transition: isDrag
                                            ? "none"
                                            : `transform ${SLOT_SPRING.cssDuration} ${SLOT_SPRING.cssEasing}`,
                                        filter: isDrag
                                            ? "drop-shadow(0 12px 18px rgba(0,0,0,0.5))"
                                            : undefined,
                                    }}
                                >
                                    <StackAbilityTile
                                        cardId={cardId}
                                        abilityText={abilityText}
                                        kind="triggered"
                                    />
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center justify-end px-2 font-beleren text-lg tracking-widest text-accent">
                    TOP OF STACK →
                </div>

                <div className="flex justify-center">
                    <button
                        type="button"
                        disabled={submitting}
                        onClick={handleConfirm}
                        className="rounded-full border border-accent bg-accent/10 px-10 py-2 font-beleren text-base tracking-wide text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
