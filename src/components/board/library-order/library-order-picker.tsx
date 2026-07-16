// The ordered top-of-library drag picker (scry / surveil / ponder) — the real
// UI, folded in from the throwaway `prototype/scry`. Rebuilt on the HAND's
// reorder mechanism (pointer capture + DEFERRED commit) rather than a dnd
// library: the card's DOM node never moves during a drag (it stays keyed by
// INSTANCE id, only its transform changes), so pointer capture is never dropped
// mid-gesture — the same trick that makes the hand smooth.
//
// One continuous strip: [ second zone ][ library mock ][ top zone ]. Which side
// of the library a card is released on decides its destination:
//   • Scry    (`library-bottom`) — second zone = BOTTOM of library (fused fan).
//   • Surveil (`graveyard`)      — second zone = GRAVEYARD (detached dashed box).
//   • Ponder  (`none`)           — no second zone (all kept, order only).
// Rightmost = top of library (drawn first). On confirm the picker submits the
// kept cards topmost-first as `cardInstanceIds` and the rest as `secondZoneIds`.
//
// `distribute` mode (Impulse / Stock Up, `look-distribute`) reuses the same
// strip with different chrome: the RIGHT zone is the HAND (labelled HAND,
// constrained to exactly `keep` cards) and the LEFT zone is the ordered BOTTOM.
// Cards start in the BOTTOM zone; the player pulls exactly `keep` up to the
// hand. On confirm the hand cards go out as `cardInstanceIds`, the bottom cards
// (ordered) as `secondZoneIds`.
import { useCallback, useMemo, useRef, useState } from "react";
import type { LibraryDestination } from "@convex/gre/types";
import { SLOT_SPRING } from "~/lib/board-motion";
import { Minus } from "lucide-react";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import OrderCard from "./order-card";
import DeckMock, { DECK_W, DECK_H } from "./deck-mock";
import { CARD_W, CARD_H, LIFT, DRAG_START_PX } from "./constants";
import { computeLayout, insertionIndex, type Zone } from "./layout";

export type LookedAtCard = { instanceId: string; defId: string };

type Drag = {
    id: string;
    /** Live strip-local pointer x. */
    pointerX: number;
    /** pointer − card center at grab time, so the card tracks the pointer 1:1. */
    grabOffsetX: number;
};

const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

/** Labels + prompt copy per destination. */
function chromeFor(destination: LibraryDestination): {
    leftLabel: string;
    rightLabel: string;
    hasSecond: boolean;
    detached: boolean;
} {
    switch (destination) {
        case "library-bottom":
            return {
                leftLabel: "BOTTOM",
                rightLabel: "TOP",
                hasSecond: true,
                detached: false,
            };
        case "graveyard":
            return {
                leftLabel: "GRAVEYARD",
                rightLabel: "LIBRARY",
                hasSecond: true,
                detached: true,
            };
        case "none":
            return {
                leftLabel: "",
                rightLabel: "TOP OF LIBRARY",
                hasSecond: false,
                detached: false,
            };
    }
}

export default function LibraryOrderPicker({
    lookedAt,
    destination,
    prompt,
    submitting,
    distribute,
    putBack,
    onConfirm,
}: {
    lookedAt: LookedAtCard[];
    destination: LibraryDestination;
    prompt: string;
    submitting: boolean;
    /** `look-distribute` mode (Impulse / Stock Up): the RIGHT zone is the HAND
     *  (exactly `keep` cards), the LEFT zone the ordered bottom. Omit for the
     *  scry/surveil/ponder order-top modes. */
    distribute?: { keep: number };
    /** `putBack` mode (Brainstorm, CR 401.4): the LEFT zone is the HAND (source
     *  pool), the RIGHT zone the TOP OF LIBRARY — pull EXACTLY `keep` cards onto
     *  the top and order them (right = topmost). The top zone is HARD-CAPPED at
     *  `keep`; leftover hand cards move nowhere (`onConfirm`'s second array is
     *  ignored by the caller). Mutually exclusive with `distribute`. */
    putBack?: { keep: number };
    /** `topTopmostFirst` = kept cards, topmost first (or the HAND cards in
     *  `distribute` mode / the cards put on top in `putBack` mode); `secondIds`
     *  = the rest, ordered, sent to the destination (empty for `none` and
     *  ignored by the `putBack` caller). Both are INSTANCE ids. */
    onConfirm: (topTopmostFirst: string[], secondIds: string[]) => void;
}) {
    // Issue #315 — collapse this full-screen picker to the board indicator so
    // the chooser can inspect the battlefield mid-order, then restore. Hidden
    // via `display:none` (not unmounted) so the drag-ordering state survives a
    // minimize/restore cycle; the Pending Choice (CR 608.2) stays active.
    const { isMinimized, minimize } = useMinimizedChoice();

    const chrome = distribute
        ? {
              leftLabel: "BOTTOM",
              rightLabel: "HAND",
              hasSecond: true,
              detached: false,
          }
        : putBack
          ? {
                leftLabel: "HAND",
                rightLabel: "TOP OF LIBRARY",
                hasSecond: true,
                // Detached so the HAND pool reads as its own zone, set apart
                // from the library with the wider gap (GAP_DETACHED).
                detached: true,
            }
          : chromeFor(destination);
    const { leftLabel, rightLabel, hasSecond, detached } = chrome;

    // Both `distribute` and `putBack` are "pool" modes: every card starts in the
    // LEFT (`second`) zone and the player pulls exactly `keep` into the RIGHT
    // (`top`) zone. `putBack` additionally HARD-CAPS the top zone at `keep`.
    const poolMode = distribute !== undefined || putBack !== undefined;
    const keep = distribute?.keep ?? putBack?.keep;
    const topCap = putBack ? putBack.keep : undefined;

    const defById = useMemo(
        () => Object.fromEntries(lookedAt.map((c) => [c.instanceId, c.defId])),
        [lookedAt]
    );

    // Committed order (instance ids), stored LEFT→RIGHT with rightmost = top of
    // library. In order-top mode `lookedAt` arrives top-to-bottom (index 0 =
    // current top) and is REVERSED into the fan so the current top card sits
    // rightmost — confirming without any drag reproduces the original order
    // exactly. In `distribute` mode every card starts in the BOTTOM (left) zone
    // in look order; the player pulls exactly `keep` up to the HAND (right)
    // zone. Dragging moves cards between the two arrays ON RELEASE only
    // (deferred commit).
    const [top, setTop] = useState<string[]>(() =>
        poolMode ? [] : [...lookedAt].reverse().map((c) => c.instanceId)
    );
    const [second, setSecond] = useState<string[]>(() =>
        poolMode ? lookedAt.map((c) => c.instanceId) : []
    );
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

    // ---- Live drop resolution (pure; recomputed each render while dragging) ----
    const view = useMemo(() => {
        if (!drag) {
            const layout = computeLayout(
                second.length,
                top.length,
                hasSecond,
                detached
            );
            const place = new Map<string, { x: number; z: number }>();
            second.forEach((id, i) =>
                place.set(id, { x: layout.center("second", i), z: 10 + i })
            );
            top.forEach((id, i) =>
                place.set(id, { x: layout.center("top", i), z: 200 + i })
            );
            return {
                layout,
                place,
                dragX: 0,
                _commit: null as null | {
                    destZone: Zone;
                    dropIndex: number;
                },
            };
        }

        const top0 = top.filter((id) => id !== drag.id);
        const second0 = second.filter((id) => id !== drag.id);

        const hit = computeLayout(
            second0.length,
            top0.length,
            hasSecond,
            detached
        );
        let destZone: Zone =
            hasSecond && drag.pointerX < hit.libCenter ? "second" : "top";
        // putBack cap (CR 401.4, exactly `keep` on top): the top zone holds at
        // most `topCap` cards. A HAND→top drag into an already-full top is
        // rejected (the card stays in HAND); a within-top reorder still works
        // because `top0` excludes the dragged card, so its length is under cap.
        if (topCap !== undefined && destZone === "top" && top0.length >= topCap) {
            destZone = "second";
        }
        const destArr = destZone === "second" ? second0 : top0;
        const dropIndex = insertionIndex(
            hit,
            destZone,
            destArr.length,
            drag.pointerX
        );

        const nextTop = [...top0];
        const nextSecond = [...second0];
        (destZone === "second" ? nextSecond : nextTop).splice(
            dropIndex,
            0,
            drag.id
        );

        const layout = computeLayout(
            nextSecond.length,
            nextTop.length,
            hasSecond,
            detached
        );
        const place = new Map<string, { x: number; z: number }>();
        nextSecond.forEach((id, i) =>
            place.set(id, { x: layout.center("second", i), z: 10 + i })
        );
        nextTop.forEach((id, i) =>
            place.set(id, { x: layout.center("top", i), z: 200 + i })
        );

        const dragX = clamp(
            drag.pointerX - drag.grabOffsetX,
            CARD_W / 2,
            layout.stripW - CARD_W / 2
        );

        return {
            layout,
            place,
            dragX,
            _commit: { destZone, dropIndex } as null | {
                destZone: Zone;
                dropIndex: number;
            },
        };
    }, [drag, top, second, hasSecond, detached]);

    // ---- Gesture (mirrors the hand's activation feel; no cast branch) ----
    const onPointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>, id: string) => {
            if (e.button !== 0 || submitting) return;
            const zone = top.includes(id) ? "top" : "second";
            const idx = (zone === "top" ? top : second).indexOf(id);
            const layout = computeLayout(
                second.length,
                top.length,
                hasSecond,
                detached
            );
            const center = layout.center(zone, idx);
            press.current = {
                id,
                pointerId: e.pointerId,
                startX: e.clientX,
                startY: e.clientY,
                grabOffsetX: localX(e.clientX) - center,
                active: false,
            };
        },
        [top, second, hasSecond, detached, localX, submitting]
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
        const c = view._commit;
        setDrag(null);
        if (!c) return;
        const top0 = top.filter((id) => id !== p.id);
        const second0 = second.filter((id) => id !== p.id);
        if (c.destZone === "second") {
            second0.splice(c.dropIndex, 0, p.id);
        } else {
            top0.splice(c.dropIndex, 0, p.id);
        }
        setTop(top0);
        setSecond(second0);
    }, [view, top, second]);

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

    // `distribute` mode requires EXACTLY `keep` cards in the HAND (right) zone
    // before Done is legal (the engine enforces count = keep; gating here avoids
    // a rejected submit). order-top modes accept any split.
    const confirmDisabled =
        submitting || (keep !== undefined ? top.length !== keep : false);

    const handleConfirm = () => {
        if (confirmDisabled) return;
        // Rightmost = topmost, so reverse the left→right `top` array.
        const topTopmostFirst = [...top].reverse();
        onConfirm(topTopmostFirst, hasSecond ? second : []);
    };

    const containerH = CARD_H + LIFT;

    return (
        <div
            className={`fixed inset-0 z-50 items-center justify-center bg-black/70 p-6 ${
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
                    {prompt}
                </p>

                {/* overflow-hidden (not auto): a dragged card lifted to the edge
                    must never spawn a scrollbar. Horizontal padding gives the
                    scaled edge cards + their drop-shadow room to breathe. */}
                <div className="flex justify-center overflow-hidden px-10 py-8">
                    <div
                        ref={containerRef}
                        className="relative shrink-0 touch-none select-none"
                        style={{
                            width: view.layout.stripW,
                            height: containerH,
                        }}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerUp}
                        onPointerCancel={onPointerUp}
                        onLostPointerCapture={onLostPointerCapture}
                    >
                        {detached && (
                            <div
                                className="absolute rounded-xl border-2 border-dashed border-secondary-accent/60 bg-secondary-accent/5"
                                style={{
                                    left: view.layout.secondStart - 10,
                                    top: LIFT - 6,
                                    width: view.layout.secondSlotW + 20,
                                    height: CARD_H + 12,
                                    zIndex: 0,
                                }}
                            />
                        )}

                        <div
                            className="absolute"
                            style={{
                                left: view.layout.libStart,
                                top: LIFT,
                                width: DECK_W,
                                height: DECK_H,
                                zIndex: 100,
                            }}
                        >
                            <DeckMock />
                        </div>

                        {lookedAt.map((c) => {
                            const p = view.place.get(c.instanceId);
                            const isDrag = drag?.id === c.instanceId;
                            const x = isDrag ? view.dragX : (p?.x ?? 0);
                            const z = isDrag ? 999 : (p?.z ?? 1);
                            return (
                                <div
                                    key={c.instanceId}
                                    className={
                                        submitting
                                            ? "absolute"
                                            : "absolute cursor-grab active:cursor-grabbing"
                                    }
                                    onPointerDown={(e) =>
                                        onPointerDown(e, c.instanceId)
                                    }
                                    style={{
                                        left: 0,
                                        top: LIFT,
                                        width: CARD_W,
                                        zIndex: z,
                                        transform: `translate(${x - CARD_W / 2}px, ${
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
                                    <OrderCard defId={defById[c.instanceId]} />
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="flex items-center justify-between px-2 font-beleren text-lg tracking-widest text-muted-foreground">
                    <span>{leftLabel}</span>
                    <span className="text-accent">{rightLabel}</span>
                </div>

                <div className="flex justify-center">
                    <button
                        type="button"
                        disabled={confirmDisabled}
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
