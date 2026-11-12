import { useEffect, useState, type RefObject } from "react";
import type { AnchorPoint } from "~/lib/target-arrow-geometry";
import { anchorNodeKeyOf } from "~/lib/targeting-session";

export type TargetingPointer = {
    /** Cursor in the overlay's coordinates; `null` before the first move, and
     *  for touch — a finger has no hover, so no arrow rides it. */
    point: AnchorPoint | null;
    /** `kind:id` of the board node under the cursor, if it carries an arrow
     *  anchor — the snap candidate. */
    overKey: string | null;
    /** Board points of `card`-kind sources (a spell still in its hand slot),
     *  measured from the slot element: no anchor bucket publishes them. */
    cardPoints: Record<string, AnchorPoint>;
};

const IDLE: TargetingPointer = { point: null, overKey: null, cardPoints: {} };

function measureCards(
    ids: readonly string[],
    origin: DOMRect
): Record<string, AnchorPoint> {
    const out: Record<string, AnchorPoint> = {};
    for (const id of ids) {
        const el = document.querySelector(
            `[data-card-slot="${CSS.escape(id)}"]`
        );
        const r = el?.getBoundingClientRect();
        if (!r || r.width === 0) continue;
        out[id] = {
            x: r.left + r.width / 2 - origin.left,
            y: r.top + r.height / 2 - origin.top,
        };
    }
    return out;
}

/** Follows the cursor while a target choice is open (issue #9163). Passive:
 *  a window `pointermove` listener, so the overlay stays `pointer-events:
 *  none` and every click still lands on the real card / nameplate. */
export function useTargetingPointer(
    overlayRef: RefObject<Element | null>,
    active: boolean,
    cardSourceIds: readonly string[]
): TargetingPointer {
    const [state, setState] = useState<TargetingPointer>(IDLE);
    const cardKey = cardSourceIds.join(",");

    useEffect(() => {
        if (!active) return;
        const ids = cardKey ? cardKey.split(",") : [];
        let raf = 0;
        let next: Omit<TargetingPointer, "cardPoints"> = {
            point: null,
            overKey: null,
        };
        const flush = () => {
            raf = 0;
            const origin = overlayRef.current?.getBoundingClientRect();
            if (!origin) return;
            setState({ ...next, cardPoints: measureCards(ids, origin) });
        };
        const schedule = () => {
            if (!raf) raf = requestAnimationFrame(flush);
        };
        const onMove = (e: PointerEvent) => {
            const origin = overlayRef.current?.getBoundingClientRect();
            if (!origin) return;
            next =
                e.pointerType === "touch"
                    ? { point: null, overKey: null }
                    : {
                          point: {
                              x: e.clientX - origin.left,
                              y: e.clientY - origin.top,
                          },
                          overKey: anchorNodeKeyOf(e.target),
                      };
            schedule();
        };
        schedule();
        window.addEventListener("pointermove", onMove);
        window.addEventListener("resize", schedule);
        return () => {
            if (raf) cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("resize", schedule);
            // The next choice starts from no cursor, not this one's last.
            setState(IDLE);
        };
    }, [active, cardKey, overlayRef]);

    return active ? state : IDLE;
}
