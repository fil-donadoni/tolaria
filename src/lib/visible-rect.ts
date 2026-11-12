/** A viewport rect (the subset of `DOMRect` the arrow/focus code reads). */
export type ViewportRect = {
    left: number;
    top: number;
    width: number;
    height: number;
};

/** Computed `overflow` values that clip descendants. Anything else — `visible`
 *  or an engine's empty default — does not. */
const CLIPPING = new Set(["hidden", "auto", "scroll", "clip"]);

/**
 * The part of `el` actually on screen (issue #9326): its box intersected with
 * every ancestor that clips (computed `overflow` hidden / auto / scroll /
 * clip on either axis). A stack row half scrolled out of the stack panel is only its
 * visible slice; a row scrolled fully out is `null`. Viewport coordinates.
 *
 * Reads layout (`getBoundingClientRect` + `getComputedStyle` per ancestor), so
 * callers run it in measure passes — never during render.
 */
export function visibleRect(el: Element): ViewportRect | null {
    const r = el.getBoundingClientRect();
    let x1 = r.left;
    let y1 = r.top;
    let x2 = r.right;
    let y2 = r.bottom;
    for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (!CLIPPING.has(cs.overflowX) && !CLIPPING.has(cs.overflowY))
            continue;
        const pr = p.getBoundingClientRect();
        x1 = Math.max(x1, pr.left);
        y1 = Math.max(y1, pr.top);
        x2 = Math.min(x2, pr.right);
        y2 = Math.min(y2, pr.bottom);
    }
    return x2 - x1 > 0 && y2 - y1 > 0
        ? { left: x1, top: y1, width: x2 - x1, height: y2 - y1 }
        : null;
}
