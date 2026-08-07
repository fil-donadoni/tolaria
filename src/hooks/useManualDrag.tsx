import { useEffect, useRef, useState } from "react";
import CardImage from "~/components/cards/card-image";
import {
    applyManualDrop,
    resolveManualDrop,
    type ManualDropProbe,
} from "~/lib/manual-drop";
import type { ManualRuntime } from "~/lib/manual-runtime";
import type { ManualZone } from "@convex/manual";

/** Pointer travel (px) before a press becomes a drag rather than a click —
 *  same threshold the hand-written manual board used. */
const DRAG_THRESHOLD = 4;

/** Every inert hit-test handle a drag can START from: a battlefield permanent,
 *  a presentational hand/pile card, or the interactive hand card. */
const DRAG_SOURCE_SELECTOR =
    "[data-arrow-anchor-permanent],[data-board-card],[data-board-hand-card]";

/** Reads the instance id off whichever handle matched. */
function sourceInstanceId(el: Element): string | null {
    return (
        el.getAttribute("data-arrow-anchor-permanent") ??
        el.getAttribute("data-board-card") ??
        el.getAttribute("data-board-hand-card")
    );
}

/** Resolves the DOM under a drop point into a {@link ManualDropProbe}. The
 *  only DOM-touching step of the drop; the decision itself is pure
 *  (`manual-drop.ts`). */
function probeDropTarget(clientX: number, clientY: number): ManualDropProbe {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return { permanentId: null, zone: null, zoneOwnerId: null };
    const permanent = el.closest("[data-arrow-anchor-permanent]");
    const zoneEl = el.closest("[data-zone-drop]");
    return {
        permanentId:
            permanent?.getAttribute("data-arrow-anchor-permanent") ?? null,
        zone: (zoneEl?.getAttribute("data-zone-drop") as ManualZone) ?? null,
        zoneOwnerId: zoneEl?.getAttribute("data-zone-owner") ?? null,
    };
}

/** Was the pointer released over the manual board itself? Answered off the
 *  board root's own inert `data-manual-board` attribute (`manual-board-view.tsx`)
 *  rather than a ref, so the hook keeps returning a plain, ref-free record. */
function isOverBoard(target: EventTarget | null): boolean {
    return (
        target instanceof Element &&
        target.closest("[data-manual-board]") !== null
    );
}

type DragMeta = {
    instanceId: string;
    startX: number;
    startY: number;
    active: boolean;
};

/** The Manual Board's zone-to-zone drag (PRD #2162, issue #2169).
 *
 *  The shared spatial surface has no drag of its own on the battlefield (its
 *  hand owns a view-only reorder drag, which the Manual Board switches off via
 *  `handInteractive={false}`), so this is a single delegated gesture: one
 *  `pointerdown` on the manual root picks its source by hit-test handle,
 *  `pointermove` past {@link DRAG_THRESHOLD} arms the drag and floats a ghost,
 *  and `pointerup` resolves the drop against whatever the pointer is over.
 *
 *  **The gesture terminates on the WINDOW, not on the board element.** Only
 *  `pointerdown` is bound on the root (it is the only step that needs the board
 *  as a delegation scope); move / up / cancel are bound on `window` for the
 *  lifetime of the press. That is load-bearing, not defensive: the Manual
 *  Board's `<main>` is a SIBLING of the `ManualLog` surface
 *  (`manual-log-surface.tsx`, mounted by `manual-board-view.tsx` — a
 *  collapsed overlay since issue #2172, previously a permanently docked
 *  320px rail), so a drag released over the log — or outside the window
 *  entirely — would never deliver `pointerup` to the board. Bound on the
 *  root, such a release discarded the drop, stranded the fixed-position
 *  ghost on screen and left the click-swallow armed. The deleted
 *  `manual-board.tsx` avoided that with `setPointerCapture` (`:222`), which
 *  would have worked for the log surface too; window listeners were preferred
 *  because they also survive an unmount mid-gesture without a stale capture
 *  element, need no release on any exit path, and are drivable in jsdom.
 *  (Capture retargets `pointerup` to the capture element, but that would NOT
 *  have made "was this released over the board?" unanswerable — the hook
 *  already answers spatial questions from coordinates, as `probeDropTarget`
 *  does with `document.elementFromPoint`.)
 *
 *  **Nothing survives a gesture boundary.** `onPointerDown` clears the previous
 *  gesture — listeners, press metadata, ghost, click-swallow — before it looks
 *  at anything, because a press whose `pointerup` AND `pointercancel` were both
 *  lost (window blur, OS interruption) leaves all four behind with no other
 *  path back to a clean state.
 *
 *  A completed drag swallows the click that follows it (capture phase), so
 *  releasing a drag over a permanent never also taps it.
 *
 *  Lifecycle guard: `manual-drag-lifecycle.test.tsx`. */
export function useManualDrag(runtime: ManualRuntime) {
    const metaRef = useRef<DragMeta | null>(null);
    const swallowClickRef = useRef(false);
    /** Takes down the window listeners of the gesture in flight. */
    const detachRef = useRef<(() => void) | null>(null);
    const [drag, setDrag] = useState<DragMeta | null>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    // The gesture's listeners deliberately outlive the board element's own
    // event scope, so an unmount mid-drag has to take them down itself.
    useEffect(() => () => detachRef.current?.(), []);

    /** Clears every trace of the gesture: listeners, press metadata, ghost. */
    function clearGesture() {
        detachRef.current?.();
        detachRef.current = null;
        metaRef.current = null;
        setDrag(null);
        setOffset({ x: 0, y: 0 });
    }

    function onWindowPointerMove(e: PointerEvent) {
        const meta = metaRef.current;
        if (!meta) return;
        const dx = e.clientX - meta.startX;
        const dy = e.clientY - meta.startY;
        if (!meta.active) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            meta.active = true;
            setDrag({ ...meta });
        }
        setOffset({ x: dx, y: dy });
    }

    function onWindowPointerUp(e: PointerEvent) {
        const meta = metaRef.current;
        const overBoard = isOverBoard(e.target);
        clearGesture();
        if (!meta?.active) return;
        // The browser fires `click` after `pointerup`; a drag is not a click,
        // so the next one is swallowed by `onClickCapture`. Arm it ONLY for a
        // release over the board: that capture handler is the sole consumer, so
        // arming it for a release over the log rail would leave the flag set and
        // eat the next legitimate click on the board instead.
        swallowClickRef.current = overBoard;
        const card = runtime.cardById.get(meta.instanceId);
        if (!card) return;
        applyManualDrop(
            resolveManualDrop({
                card,
                probe: probeDropTarget(e.clientX, e.clientY),
                dx: e.clientX - meta.startX,
                dy: e.clientY - meta.startY,
            }),
            runtime.dispatch
        );
    }

    function onWindowPointerCancel() {
        clearGesture();
    }

    const handlers = {
        onPointerDown(e: React.PointerEvent) {
            // A new press closes the previous gesture, whatever state it was
            // left in. Both lines are unconditional, ahead of every early
            // return below, because the invariant is "nothing survives a
            // gesture boundary" — not "things are tidied when the press happens
            // to start on a card".
            //
            // The swallow flag: the swallowed `click` always arrives before the
            // next `pointerdown`, so a flag still set here can only be stale.
            //
            // The gesture itself: `pointerup` and `pointercancel` normally
            // clear it, but a press interrupted by a window blur can deliver
            // neither, which strands the fixed-position ghost on screen and
            // leaves the dead gesture's window listeners live — a later stray
            // `pointerup` would then resolve a drop for a card the user let go
            // of long ago. `clearGesture()` here is the only path back.
            swallowClickRef.current = false;
            clearGesture();
            if (e.button !== 0) return;
            const target = e.target as Element | null;
            const source = target?.closest?.(DRAG_SOURCE_SELECTOR) ?? null;
            if (!source) return;
            const instanceId = sourceInstanceId(source);
            if (!instanceId || !runtime.cardById.has(instanceId)) return;
            metaRef.current = {
                instanceId,
                startX: e.clientX,
                startY: e.clientY,
                active: false,
            };
            setOffset({ x: 0, y: 0 });
            // Re-entrancy needs nothing here: the unconditional
            // `clearGesture()` above already detached any gesture still in
            // flight, so a second pointerdown with no intervening up (a second
            // finger, a lost event) replaces the first rather than leaking its
            // listeners.
            const move = onWindowPointerMove;
            const up = onWindowPointerUp;
            const cancel = onWindowPointerCancel;
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
            window.addEventListener("pointercancel", cancel);
            detachRef.current = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                window.removeEventListener("pointercancel", cancel);
            };
        },
        onClickCapture(e: React.MouseEvent) {
            if (!swallowClickRef.current) return;
            swallowClickRef.current = false;
            e.preventDefault();
            e.stopPropagation();
        },
    };

    const dragCard = drag?.active
        ? runtime.cardById.get(drag.instanceId)
        : undefined;
    const ghost =
        drag?.active && dragCard ? (
            <div
                data-manual-drag-ghost={drag.instanceId}
                className="fixed pointer-events-none z-50 opacity-80"
                style={{
                    left: drag.startX + offset.x - 50,
                    top: drag.startY + offset.y - 70,
                    width: 100,
                    height: 140,
                }}
            >
                <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-lg">
                    <CardImage
                        card={{ id: dragCard.card.id }}
                        sizes="100px"
                        includeThumb={false}
                    />
                </div>
            </div>
        ) : null;

    return { handlers, ghost };
}
