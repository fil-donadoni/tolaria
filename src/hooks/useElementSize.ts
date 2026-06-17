import { useLayoutEffect, useRef, useState } from "react";

/** Tracks the live pixel size of a DOM element via `ResizeObserver`. Returns a
 *  ref to attach plus the current `{ width, height }`. Used by the spatial
 *  board to feed the pure layout math its container dimensions (#251). */
export function useElementSize<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        // Seed immediately so the first paint has real dimensions.
        setSize({ width: el.clientWidth, height: el.clientHeight });
        const ro = new ResizeObserver(() => {
            setSize({ width: el.clientWidth, height: el.clientHeight });
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    return { ref, size };
}
