import { useEffect, useState } from "react";

/** How far outside the viewport a slot counts as near: the margin a native
 *  `loading="lazy"` image is fetched at is a few viewports on a fast network
 *  and ~1250px in Chrome by default; one viewport's worth keeps a scroll
 *  from reaching a face before its bitmap. */
export const NEAR_VIEWPORT_MARGIN = "100%";

/**
 * Whether `ref`'s element is within {@link NEAR_VIEWPORT_MARGIN} of the
 * viewport (issue #8321) — the gate a lazy face's 1x bitmap waits on. `true`
 * at once when `armed` is false or the engine has no `IntersectionObserver`
 * (fail open: eager, never withheld), and sticky once true: a face that was
 * near is not un-made when it scrolls away.
 */
export function useNearViewport(
    ref: React.RefObject<HTMLElement | null>,
    armed: boolean
): boolean {
    const observable = armed && typeof IntersectionObserver !== "undefined";
    // `false` at the start even when not yet observable: `armed` is false
    // on the first render (the slot is unmeasured), and a `true` seeded then
    // would stand once the box lands and the gate becomes observable — a
    // lazy grid resampling every face it mounts (review of issue #8321).
    const [near, setNear] = useState(false);
    useEffect(() => {
        if (!observable || near) return;
        const el = ref.current;
        if (!el) {
            setNear(true);
            return;
        }
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) {
                    setNear(true);
                    io.disconnect();
                }
            },
            { rootMargin: NEAR_VIEWPORT_MARGIN }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [observable, near, ref]);
    return !observable || near;
}
