import { useLayoutEffect, useRef, useState } from "react";
import { cardSlotFloor, type CardSlotFloor } from "~/lib/images";
import { watchDevicePixelRatio } from "~/lib/watchDevicePixelRatio";

/**
 * Measures a card slot and derives the srcset hint it actually needs
 * (issue #3553).
 *
 * WHY IT MEASURES. The responsive candidate a browser resolves is decided by
 * `sizes × devicePixelRatio`, and `sizes` used to be a HAND-WRITTEN CONSTANT
 * per call site — with ~18 call sites declaring nothing at all and inheriting
 * the board's 140px while rendering into a 180–260px slot. That resolves a
 * rendition below the slot's device-pixel width, which is what "the art is
 * soft until I nudge the window" is: a resize re-evaluates the candidate and
 * the image silently repairs itself. A constant also cannot be right at five
 * viewports at once for a slot that grows with its container, which is every
 * grid in this app.
 *
 * WHY THE `<img>` WAITS. The floor has to hold AT FIRST PAINT, and a hint
 * applied after the image already has a `src` is too late — the browser has
 * chosen. So the caller renders no `src`/`srcSet` at all until this hook has
 * a verdict. `useLayoutEffect` runs after the DOM is committed and BEFORE the
 * browser paints, so the verdict always arrives within the first frame: the
 * request starts one commit later, never a paint later.
 *
 * WHY A VERDICT AND NOT A WIDTH. `state === null` means "not measured yet";
 * `{ floor: null }` means "measured, and there is no usable box" — a
 * zero-width slot, or an environment with no layout engine at all (happy-dom,
 * where every rect is 0). The two are different answers and the caller treats
 * them differently: the first withholds the image, the second falls back to
 * the call site's declared hint so tests and degenerate layouts keep working.
 *
 * The `ResizeObserver` keeps the floor true when the slot grows later (a panel
 * opening, an orientation change), and `watchDevicePixelRatio` when the RATIO
 * moves with no resize (issue #6940). It re-renders only when the derived
 * floor CHANGES — `CARD_SLOT_QUANTUM_PX` is what makes that rare — so a
 * drag-resize does not repaint every mounted card.
 */
export default function useCardSlotFloor<T extends HTMLElement>(): {
    /** Attach to the element whose box IS the slot (the wrapper the image
     *  fills, or the image itself when its own CSS fixes its width). */
    slotRef: React.RefObject<T | null>;
    /** The measured floor, or `null` when the slot has no usable box. */
    floor: CardSlotFloor | null;
    /** `false` until the first measurement has run — the caller renders no
     *  image source while it is false. */
    measured: boolean;
} {
    const slotRef = useRef<T | null>(null);
    const [state, setState] = useState<{ floor: CardSlotFloor | null } | null>(
        null
    );

    useLayoutEffect(() => {
        const el = slotRef.current;
        const read = () => {
            // `offsetWidth`, the LAYOUT box — never `getBoundingClientRect`,
            // which returns the axis-aligned box of the TRANSFORMED result. A
            // tapped permanent is drawn rotated 90°, so its rect reports the
            // card's height as its width; the image rotates with the box and
            // its own horizontal axis still spans the layout width. The ui-gate
            // probe measures the same quantity for the same reason.
            const width = el ? el.offsetWidth : 0;
            const next =
                width > 0
                    ? cardSlotFloor(width, window.devicePixelRatio || 1)
                    : null;
            setState((prev) =>
                prev &&
                prev.floor?.sizes === next?.sizes &&
                prev.floor?.includeThumb === next?.includeThumb
                    ? prev
                    : { floor: next }
            );
        };
        // The floor is `width × devicePixelRatio`, and only the width has a
        // resize signal. The ratio moves with no layout change at all — the
        // window dragged onto a 2x display, a browser zoom — and a floor
        // computed for the old ratio under-declares until something else
        // happens to re-measure (issue #6940). `watchDevicePixelRatio` is the
        // media-query trick that turns the ratio into an event; armed BEFORE
        // the first read so no change can fall between the two.
        const unwatchDpr = watchDevicePixelRatio(read);
        read();
        if (!el || typeof ResizeObserver === "undefined") return unwatchDpr;
        const observer = new ResizeObserver(read);
        observer.observe(el);
        return () => {
            observer.disconnect();
            unwatchDpr();
        };
    }, []);

    return { slotRef, floor: state?.floor ?? null, measured: state !== null };
}
