import { useLayoutEffect, useRef } from "react";

/** Which of the surface's two dimensions gets published. A primitive rather
 *  than a `(rect) => number` callback so the effect can depend on it directly:
 *  a caller's inline arrow changes identity every render and would re-install
 *  the `ResizeObserver` on each of the parent's re-renders (and a ref stashing
 *  it would be a ref write during render, which the React Compiler rejects). */
export type CssSizeAxis = "width" | "height";

/** Publishes ONE measured dimension of a `fixed` controller surface to
 *  `document.documentElement` as a CSS custom property, so every consumer that
 *  must stay clear of that surface reserves the space it ACTUALLY occupies
 *  instead of a hard-coded guess.
 *
 *  Extracted on the second occurrence (the project's extract-on-2nd rule):
 *  {@link useControllerBarHeight} publishes the portrait bottom bar's HEIGHT
 *  (#1759) and {@link useControllerStripWidth} publishes the landscape-compact
 *  strip's WIDTH (#1769). Both surfaces are state-dependent — the bar's command
 *  row wraps, the strip grows a side-pill stack — so both must republish rather
 *  than be measured once.
 *
 *  The document root is the publication point because consumers are `fixed`
 *  elements living in unrelated subtrees: it is the only shared ancestor. The
 *  variable is removed on unmount, so a mode that does NOT mount the surface
 *  falls back to the consumer's own `var(..., <fallback>)` default.
 *
 *  `useLayoutEffect` so the first paint already carries the real measurement
 *  rather than the fallback, and a seeding call before the observer because
 *  `ResizeObserver`'s first callback is asynchronous. */
export function useCssSizeVar<T extends HTMLElement>(
    variable: string,
    axis: CssSizeAxis
) {
    const ref = useRef<T>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const root = document.documentElement;
        const publish = () => {
            root.style.setProperty(
                variable,
                `${el.getBoundingClientRect()[axis]}px`
            );
        };
        publish();
        const ro = new ResizeObserver(publish);
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.removeProperty(variable);
        };
    }, [variable, axis]);

    return ref;
}
