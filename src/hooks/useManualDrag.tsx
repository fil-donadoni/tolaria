import { useRef, useState } from "react";
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
 *  `handInteractive={false}`), so this is a single delegated gesture bound on
 *  the manual container's root: one `pointerdown` anywhere inside picks its
 *  source by hit-test handle, `pointermove` past {@link DRAG_THRESHOLD} arms
 *  the drag and floats a ghost, and `pointerup` resolves the drop against
 *  whatever the pointer is over.
 *
 *  A completed drag swallows the click that follows it (capture phase), so
 *  releasing a drag over a permanent never also taps it. */
export function useManualDrag(runtime: ManualRuntime) {
    const metaRef = useRef<DragMeta | null>(null);
    const swallowClickRef = useRef(false);
    const [drag, setDrag] = useState<DragMeta | null>(null);
    const [offset, setOffset] = useState({ x: 0, y: 0 });

    function reset() {
        metaRef.current = null;
        setDrag(null);
        setOffset({ x: 0, y: 0 });
    }

    const handlers = {
        onPointerDown(e: React.PointerEvent) {
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
        },
        onPointerMove(e: React.PointerEvent) {
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
        },
        onPointerUp(e: React.PointerEvent) {
            const meta = metaRef.current;
            reset();
            if (!meta?.active) return;
            // The browser fires `click` after `pointerup`; a drag is not a
            // click, so the next one is swallowed below.
            swallowClickRef.current = true;
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
        },
        onPointerCancel() {
            reset();
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
