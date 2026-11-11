import { useEffect, useRef } from "react";

export const WHEEL_ZOOM_STEP = 0.1;

/**
 * ⌘/Ctrl + wheel over the Booster band resizes the whole grid (issue #9166).
 * `onStep(+1 | -1)` is called once per wheel event; the page's own browser
 * zoom is suppressed only while the pointer is over the band.
 */
export function useDraftPackWheelZoom(
    enabled: boolean,
    onStep: (direction: 1 | -1) => void
) {
    const stepRef = useRef(onStep);
    useEffect(() => {
        stepRef.current = onStep;
    }, [onStep]);

    useEffect(() => {
        if (!enabled) return;
        const onWheel = (e: WheelEvent) => {
            if (!(e.ctrlKey || e.metaKey)) return;
            if (
                !(e.target instanceof Element) ||
                !e.target.closest('[data-slot="draft-stacked-booster"]')
            )
                return;
            e.preventDefault();
            stepRef.current(e.deltaY < 0 ? 1 : -1);
        };
        window.addEventListener("wheel", onWheel, { passive: false });
        return () => window.removeEventListener("wheel", onWheel);
    }, [enabled]);
}
