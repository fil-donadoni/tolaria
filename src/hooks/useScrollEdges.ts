import { useCallback, useEffect, useRef, useState } from "react";

export type ScrollEdges = { start: boolean; end: boolean };

/** Which horizontal edges of a scroller still have content beyond them
 *  (issue #3684): drives the edge fade that tells a coarse-pointer user the
 *  row scrolls. Recomputed on scroll and on any size change. */
export function useScrollEdges<T extends HTMLElement>() {
    const ref = useRef<T>(null);
    const [edges, setEdges] = useState<ScrollEdges>({
        start: false,
        end: false,
    });

    const measure = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const start = el.scrollLeft > 1;
        const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
        setEdges((prev) =>
            prev.start === start && prev.end === end ? prev : { start, end }
        );
    }, []);

    useEffect(() => {
        measure();
        const el = ref.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [measure]);

    return { ref, edges, onScroll: measure };
}
