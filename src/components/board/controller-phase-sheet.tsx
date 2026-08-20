import { useCallback, useEffect, useRef, useState } from "react";
import ControllerPhaseList from "./controller-phase-list";
import { SLOT_SPRING } from "~/lib/board-motion";

/** Pointer travel (px) before a press is treated as a drag rather than a tap —
 *  mirrors the `DRAG_START_PX` deadzone the library/trigger-order pickers use
 *  so every pointer-capture drag on the board shares the same activation feel. */
const DRAG_START_PX = 6;
/** Downward travel (px) past which releasing the handle closes the sheet.
 *  Releasing short of it springs the panel back to rest (ADR 0009's
 *  swipe-down-to-dismiss action-sheet convention, applied to the handle
 *  itself instead of the whole sheet body). */
const DISMISS_DRAG_PX = 80;

/** Portrait bottom sheet (#335) holding the full phase list. Slides up from the
 *  bottom edge with a dimmed backdrop and comfortable (large) touch targets,
 *  coherent with the ADR-0009 action-sheet pattern. It mounts the SAME
 *  {@link ControllerPhaseList} the desktop panel uses, so the YOU/OPP stop
 *  toggles route through the identical `useSkipPhasePreferences` path — only the
 *  shell (bottom sheet vs. right-edge panel) and the touch sizing differ. The
 *  `[data-phase-sheet]` flag scopes the larger hit targets via a sibling
 *  stylesheet rule without forking the list component.
 *
 *  The grab handle (issue #1761) is a real drag-to-close gesture, not just
 *  decoration: dragging it down past {@link DISMISS_DRAG_PX} closes the sheet,
 *  releasing short of that springs it back. X and the backdrop tap remain the
 *  other two ways to dismiss. */
export default function ControllerPhaseSheet({
    onClose,
}: {
    onClose: () => void;
}) {
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onClose]);

    // Live downward drag offset (px), 0 at rest. `dragging` gates the CSS
    // transition: none while the finger is tracked (immediate response), a
    // spring transition on release so a below-threshold drag visibly springs
    // back rather than snapping.
    const [dragY, setDragY] = useState(0);
    const [dragging, setDragging] = useState(false);
    const press = useRef<{
        pointerId: number;
        startY: number;
        active: boolean;
        // Live downward offset (px), mutated synchronously inside
        // `onHandlePointerMove` — the authoritative value `commit` reads.
        // `dragY` state exists ONLY to drive the transform style; it must
        // never be read for the dismiss decision (see `commit` below).
        dy: number;
    } | null>(null);

    // `pointermove` is a continuous-priority React event: `setDragY` from the
    // last move can still be an UNCOMMITTED render when the discrete,
    // sync-flushed `pointerup`/`lostpointercapture` fires right after it on a
    // fast flick. A `commit` that closed over the `dragY` STATE would then
    // read whatever value was live at commit's OWN last render — stale by one
    // (or more) moves — and spring the sheet back instead of closing. Reading
    // `press.current.dy` sidesteps the render pipeline entirely: it is a
    // plain mutable ref written synchronously in the same event-handler tick
    // as the pointer move, so it is always current regardless of whether
    // React has re-rendered yet. `commit` therefore intentionally has NO
    // dependency on `dragY` — do not add one back.
    const commit = useCallback(() => {
        const p = press.current;
        press.current = null;
        setDragging(false);
        if (p?.active && p.dy > DISMISS_DRAG_PX) {
            onClose();
        } else {
            setDragY(0);
        }
    }, [onClose]);

    const onHandlePointerDown = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            if (e.button !== 0) return;
            press.current = {
                pointerId: e.pointerId,
                startY: e.clientY,
                active: false,
                dy: 0,
            };
        },
        []
    );

    const onHandlePointerMove = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            const p = press.current;
            if (!p) return;
            const dy = e.clientY - p.startY;
            if (!p.active) {
                if (Math.abs(dy) < DRAG_START_PX) return;
                p.active = true;
                setDragging(true);
                e.currentTarget.setPointerCapture(p.pointerId);
            }
            // Downward-only: the handle is a CLOSE gesture, not a re-open one,
            // so upward travel is pinned to 0 rather than lifting the sheet.
            const clamped = Math.max(0, dy);
            p.dy = clamped;
            setDragY(clamped);
        },
        []
    );

    const onHandlePointerUp = useCallback(
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

    const onHandlePointerCancel = useCallback(() => {
        press.current = null;
        setDragging(false);
        setDragY(0);
    }, []);

    const onHandleLostPointerCapture = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            // Touch-only trap (same fix as library-order-picker.tsx /
            // trigger-order-prompt.tsx): a touch pointerdown gives the
            // pressed PILL implicit pointer capture, so the first
            // `setPointerCapture` on this WRAPPER (fired from
            // `onHandlePointerMove` once the drag activates) transfers that
            // capture away from the pill — which fires `lostpointercapture`
            // ON THE PILL, bubbling here. Committing on that bubbled event
            // would end the drag on its very first move (the "card jumps
            // away" mobile glitch this project has hit twice already). Only
            // the WRAPPER itself losing capture may commit.
            if (e.target !== e.currentTarget) return;
            if (press.current) commit();
        },
        [commit]
    );

    return (
        <div
            data-phase-sheet
            className="fixed inset-0 z-sheet flex flex-col justify-end md:hidden"
        >
            {/* Dimmed backdrop — tap to dismiss (touch + mouse both fire click). */}
            <button
                type="button"
                aria-label="Close phase list"
                onClick={onClose}
                className="absolute inset-0 bg-black/50"
            />
            <div
                // `pb-[env(safe-area-inset-bottom)]` (issue #2594): this
                // sheet docks flush to the physical bottom edge (`fixed
                // inset-0 … justify-end`), same as `action-sheet.tsx`'s
                // pattern — without it the home-indicator strip on a
                // notched phone sits on top of the last phase row instead of
                // below the sheet's own padding.
                className="relative flex max-h-[70vh] w-full flex-col animate-[sheetUp_0.2s_ease-out] overflow-hidden rounded-t-2xl border-t border-border-subtle bg-surface shadow-2xl backdrop-blur-md pb-[env(safe-area-inset-bottom)]"
                style={{
                    transform: dragY > 0 ? `translateY(${dragY}px)` : undefined,
                    transition: dragging
                        ? "none"
                        : `transform ${SLOT_SPRING.cssDuration} ${SLOT_SPRING.cssEasing}`,
                }}
            >
                {/* Grab handle affordance + drag-to-close gesture (#1761). The
                    hit area (h-12 = 48px) is far bigger than the visible pill,
                    matching ADR 0009's ≥48px touch-target convention. */}
                <div
                    data-testid="phase-sheet-grab-handle"
                    role="presentation"
                    aria-hidden="true"
                    className="flex h-12 w-full touch-none items-center justify-center select-none"
                    onPointerDown={onHandlePointerDown}
                    onPointerMove={onHandlePointerMove}
                    onPointerUp={onHandlePointerUp}
                    onPointerCancel={onHandlePointerCancel}
                    onLostPointerCapture={onHandleLostPointerCapture}
                >
                    <div className="h-1 w-10 rounded-full bg-border-accent" />
                </div>
                {/* The bottom bar's Phase tab shows the abbreviated
                 *  `compact` step word in this portrait context, so the
                 *  sheet is the one place the row's `({compact})` decoder
                 *  earns its keep (#1860 review round 3, finding 2). */}
                <ControllerPhaseList onClose={onClose} showCompactDecoder />
            </div>
        </div>
    );
}
