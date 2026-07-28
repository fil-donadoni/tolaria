import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Minus } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PendingChoice, StackItem } from "~/types/game";
import { getStackAbilityOracleText } from "~/lib/card-utils";
import { useGameContext } from "~/hooks/useGameContext";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
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

const TILE_W = 152;
const GAP = 20;
const SLOT = TILE_W + GAP;
const LIFT = 18;
const DRAG_START_PX = 6;
// StackAbilityTile is an art-crop (ART_CROP_RATIO) plus a two/three-line oracle
// footer; this fixed height comfortably clears the tallest footer at TILE_W.
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

    const center = (i: number) => i * SLOT + TILE_W / 2;
    const stripW = order.length * SLOT - GAP;

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
            Math.round((draggedCenter - TILE_W / 2) / SLOT),
            0,
            rest.length
        );
        const next = [...rest];
        next.splice(dropIndex, 0, drag.id);
        const place = new Map<string, number>();
        next.forEach((id, i) => place.set(id, center(i)));
        const dragX = clamp(draggedCenter, TILE_W / 2, stripW - TILE_W / 2);
        return { place, dragX, _commit: dropIndex };
    }, [drag, order, stripW]);

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
        [order, localX, submitting]
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

    const onLostPointerCapture = useCallback(() => {
        if (press.current) commit();
    }, [commit]);

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
            className={`fixed inset-0 z-modal items-center justify-center bg-scrim p-6 ${
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
                    scrollbar. Padding gives the lifted/scaled tile room. */}
                <div className="flex justify-center overflow-x-auto overflow-y-hidden px-10 py-6">
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
                                        width: TILE_W,
                                        zIndex: isDrag ? 999 : 1,
                                        transform: `translate(${dx - TILE_W / 2}px, ${
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
