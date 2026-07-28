import { useEffect, useState } from "react";

/** Reactive `window.innerWidth` (issue #1765). The full-screen drag-reorder
 *  strips (`LibraryOrderPicker`, `TriggerOrderPrompt`) shrink their tile width
 *  to fit the LIVE viewport rather than a fixed CSS breakpoint bucket — a
 *  phone rotated mid-choice, or a desktop window resized, must reflow the
 *  strip immediately. `ResizeObserver`/`useElementSize` was considered
 *  instead of a window listener, but jsdom's `clientWidth` is always 0 (no
 *  real layout), which would make the fit math untestable; `window.innerWidth`
 *  is a real, settable number under jsdom, so a viewport-width test can drive
 *  the exact same code path a phone does.
 *
 *  SSR/no-`window` environments default to a generous desktop width so the
 *  first render never over-shrinks before hydration. */
export function useViewportWidth(): number {
    const [width, setWidth] = useState(() =>
        typeof window === "undefined" ? 1024 : window.innerWidth
    );

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onResize = () => setWidth(window.innerWidth);
        onResize();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return width;
}
