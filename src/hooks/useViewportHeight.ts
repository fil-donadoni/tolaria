import { useEffect, useState } from "react";

/** Reactive `window.innerHeight` (#1768) — the vertical twin of
 *  {@link useViewportWidth}.
 *
 *  The landscape-compact board derives its ONE shared card footprint from the
 *  board's height (`landscapeCardMetrics`), so it needs that height as a real
 *  number, live: a phone rotated mid-game, or the browser chrome collapsing on
 *  scroll, must re-derive the scale immediately.
 *
 *  A window listener rather than `useElementSize`/`ResizeObserver` on the board
 *  root, for the same two reasons `useViewportWidth` gives: jsdom has no layout
 *  engine (every `clientHeight` is 0, which would make the scale math
 *  untestable) while `window.innerHeight` is a real, settable number a test can
 *  drive; and observing the board root would re-render the whole board on every
 *  incidental reflow rather than only on a genuine viewport change.
 *
 *  SSR / no-`window` defaults to a generous desktop height so the first render
 *  never over-shrinks before hydration. */
export function useViewportHeight(): number {
    const [height, setHeight] = useState(() =>
        typeof window === "undefined" ? 768 : window.innerHeight
    );

    useEffect(() => {
        if (typeof window === "undefined") return;
        const onResize = () => setHeight(window.innerHeight);
        onResize();
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return height;
}
