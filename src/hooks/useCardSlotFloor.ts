import { useLayoutEffect, useRef, useState } from "react";
import { cardSlotFloor, type CardSlotFloor } from "~/lib/images";
import { faceBitmapWanted } from "~/lib/faceBitmaps";
import { watchDevicePixelRatio } from "~/lib/watchDevicePixelRatio";

/** The slot's DRAWN box in DEVICE pixels, exact — what a 1x face is
 *  resampled to (issue #8321). `null` on a display the srcset path serves
 *  (DPR ≥ 1.5), so a Retina slot re-renders only when its quantised floor
 *  moves. */
export interface CardSlotBox {
    w: number;
    h: number;
    dpr: number;
}

/** How long after a window resize the slot is read again: a spatial zone
 *  re-lays its slots out after the resize event, and a read before that
 *  would size the bitmap to the old placement. */
export const SLOT_SETTLE_REREAD_MS = 450;

/**
 * Measures a card slot and derives the srcset hint it actually needs
 * (issue #3553), and on a 1x display its exact drawn device box (issue #8321).
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
 * WHY AN EXACT BOX TOO, AND ONLY AT 1x. The floor is quantised
 * (`CARD_SLOT_QUANTUM_PX`) so a drag-resize does not re-render every card;
 * the 1x bitmap (`~/lib/faceBitmaps.ts`) must be the slot's size to the
 * pixel or the compositor resamples it again — which is the defect. The box
 * is the LAYOUT box, like the floor: never the bounding rect, which mid-way
 * through a dialog's `zoom-in-95`, a zone's reflow spring or a `motion` FLIP
 * is a size the card is only passing through (measured on this lane:
 * rect-sized bitmaps came out 106px for a 112px tile and read as upscaled);
 * and never an ancestor's transform scale, inline or computed — a `motion`
 * entrance running `scale` from 0.1 to 1 gave a 64px face an 8px bitmap from
 * its first frame, and the spatial slot's standing `scale()` read against
 * its promoted layer (rastered at scale 1, then composited down) gave a
 * bitmap of the drawn size that read SOFTER than one of the layout size
 * (0.69 against the box-filtered reference, issue #8321's census). A
 * scaled spatial slot therefore draws a layout-size bitmap through its
 * scale: one compositor step down, the residue ADR 0168 states. The box
 * exists only where the bitmap path runs — on a Retina display the state
 * carries no box and a sub-quantum resize still re-renders nothing.
 *
 * WHAT RE-READS IT. The `ResizeObserver` keeps the floor true when the slot
 * grows later (a panel opening, an orientation change); `watchDevicePixelRatio`
 * when the RATIO moves with no resize (its own header says why); and a window `resize`
 * listener, read at once and again once the layout has settled. It
 * re-renders only when the derived floor (or 1x box) CHANGES.
 */
export default function useCardSlotFloor<T extends HTMLElement>(): {
    /** Attach to the element whose box IS the slot (the wrapper the image
     *  fills, or the image itself when its own CSS fixes its width). */
    slotRef: React.RefObject<T | null>;
    /** The measured floor, or `null` when the slot has no usable box. */
    floor: CardSlotFloor | null;
    /** The slot's exact drawn device box on a 1x display; `null` elsewhere,
     *  and `null` while the slot has no usable box. */
    box: CardSlotBox | null;
    /** `false` until the first measurement has run — the caller renders no
     *  image source while it is false. */
    measured: boolean;
} {
    const slotRef = useRef<T | null>(null);
    const [state, setState] = useState<{
        floor: CardSlotFloor | null;
        box: CardSlotBox | null;
    } | null>(null);

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
            const height = el ? el.offsetHeight : 0;
            const dpr = window.devicePixelRatio || 1;
            const floor = width > 0 ? cardSlotFloor(width, dpr) : null;
            const box =
                el && width > 0 && height > 0 && faceBitmapWanted(dpr)
                    ? drawnBox(el, width, height, dpr)
                    : null;
            setState((prev) =>
                prev &&
                prev.floor?.sizes === floor?.sizes &&
                prev.floor?.includeThumb === floor?.includeThumb &&
                prev.box?.w === box?.w &&
                prev.box?.h === box?.h &&
                prev.box?.dpr === box?.dpr
                    ? prev
                    : { floor, box }
            );
        };
        // The floor is `width × devicePixelRatio`, and only the width has a
        // resize signal. The ratio moves with no layout change at all — the
        // window dragged onto a 2x display, a browser zoom — and a floor
        // computed for the old ratio under-declares until something else
        // happens to re-measure (the ratio watcher's own header). `watchDevicePixelRatio` is the
        // media-query trick that turns the ratio into an event; armed BEFORE
        // the first read so no change can fall between the two.
        const unwatchDpr = watchDevicePixelRatio(read);
        read();
        if (!el || typeof ResizeObserver === "undefined") return unwatchDpr;
        const observer = new ResizeObserver(read);
        observer.observe(el);
        let settleTimer: ReturnType<typeof setTimeout> | null = null;
        const onWindowResize = () => {
            read();
            if (settleTimer !== null) clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
                settleTimer = null;
                read();
            }, SLOT_SETTLE_REREAD_MS);
        };
        window.addEventListener("resize", onWindowResize);
        return () => {
            observer.disconnect();
            unwatchDpr();
            window.removeEventListener("resize", onWindowResize);
            if (settleTimer !== null) clearTimeout(settleTimer);
        };
    }, []);

    return {
        slotRef,
        floor: state?.floor ?? null,
        box: state?.box ?? null,
        measured: state !== null,
    };
}

/** The slot's box in device pixels: its layout box, exact. */
function drawnBox(
    el: HTMLElement,
    layoutW: number,
    layoutH: number,
    dpr: number
): CardSlotBox {
    void el;
    return {
        w: Math.max(1, Math.round(layoutW * dpr)),
        h: Math.max(1, Math.round(layoutH * dpr)),
        dpr,
    };
}
