import { useLayoutEffect, useRef } from "react";
import { CONTROLLER_BAR_HEIGHT_VAR } from "~/lib/controller-bar-metrics";

/** Publishes the portrait bottom bar's measured height to the document root as
 *  `--controller-bar-h` (#1759), so every consumer that must sit clear of the
 *  bar reserves the height the bar ACTUALLY has instead of a hard-coded guess.
 *
 *  The bar's command row wraps, so its height is state-dependent: ~106px on one
 *  line, ~150px once DECLARE_ATTACKERS pushes the side pills onto their own
 *  line. A `ResizeObserver` republishes on every such change, which is what
 *  keeps the portrait hand strip and the Zones drawer above the bar in states
 *  nobody enumerated (see {@link ABOVE_CONTROLLER_BAR}).
 *
 *  `useLayoutEffect` so the first paint already carries the real height rather
 *  than the class fallback. The variable is removed on unmount, so landscape /
 *  the lobby fall back to that default. */
export function useControllerBarHeight<T extends HTMLElement>() {
    const ref = useRef<T>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const root = document.documentElement;
        const publish = () => {
            root.style.setProperty(
                CONTROLLER_BAR_HEIGHT_VAR,
                `${el.getBoundingClientRect().height}px`
            );
        };
        // Seed immediately: the observer's first callback is asynchronous.
        publish();
        const ro = new ResizeObserver(publish);
        ro.observe(el);
        return () => {
            ro.disconnect();
            root.style.removeProperty(CONTROLLER_BAR_HEIGHT_VAR);
        };
    }, []);

    return ref;
}
