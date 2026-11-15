import { useEffect, type RefObject } from "react";
import { edgeScrollVelocity } from "./edge-scroll";

/** Longest frame step (ms) the loop integrates — a backgrounded tab resuming
 *  after seconds must not teleport the strip to its far end in one frame. */
const MAX_FRAME_MS = 50;

/** Frame loop that scrolls `scrollerRef` horizontally while `active` and the
 *  pointer (`getPointerClientX`, client px; `null` = no pointer) sits in an
 *  edge band of the scroller's visible box (issue #9813). It keeps scrolling
 *  with the pointer held still — the case a `pointermove`-driven scroll can
 *  never cover — and stops at the scroll extent. After every frame that moved
 *  `scrollLeft` it calls `onScrolled`, so the caller re-derives its
 *  strip-local pointer position (the content moved under a stationary
 *  pointer). Fractional per-frame steps accumulate in a carry, since browsers
 *  round `scrollLeft` and a slow ramp would otherwise never advance. */
export function useEdgeAutoScroll({
    active,
    scrollerRef,
    getPointerClientX,
    onScrolled,
}: {
    active: boolean;
    scrollerRef: RefObject<HTMLElement | null>;
    getPointerClientX: () => number | null;
    onScrolled: () => void;
}): void {
    useEffect(() => {
        if (!active) return;
        let raf = 0;
        let last: number | null = null;
        let carry = 0;
        const step = (now: number) => {
            const el = scrollerRef.current;
            const x = getPointerClientX();
            const dt = last === null ? 0 : Math.min(now - last, MAX_FRAME_MS);
            last = now;
            if (el && x !== null && dt > 0) {
                const rect = el.getBoundingClientRect();
                const v = edgeScrollVelocity(x, rect.left, rect.right);
                if (v === 0) {
                    carry = 0;
                } else {
                    carry += (v * dt) / 1000;
                    const whole = Math.trunc(carry);
                    if (whole !== 0) {
                        carry -= whole;
                        const max = Math.max(
                            0,
                            el.scrollWidth - el.clientWidth
                        );
                        const next = Math.min(
                            max,
                            Math.max(0, el.scrollLeft + whole)
                        );
                        if (next !== el.scrollLeft) {
                            el.scrollLeft = next;
                            onScrolled();
                        } else {
                            carry = 0; // pinned at the extent
                        }
                    }
                }
            }
            raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [active, scrollerRef, getPointerClientX, onScrolled]);
}
