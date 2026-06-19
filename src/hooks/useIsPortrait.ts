import { useEffect, useState } from "react";

/** The `md:` breakpoint (Tailwind default = 768px). Portrait layout applies
 *  strictly BELOW it; at/above it we are in "reduced desktop" territory even on
 *  a touch device held in landscape. */
const PORTRAIT_QUERY = "(orientation: portrait) and (max-width: 767px)";

/** Single high seam (#335) for the controller's portrait/landscape layout
 *  switch. Portrait collapses the right control column into a fixed bottom
 *  action bar + bottom sheet and drops the battlefield right gutter to 0;
 *  landscape keeps the reduced-desktop right column. Both the controller and the
 *  battlefield read THIS hook so the switch lives in one place rather than
 *  scattered breakpoint checks.
 *
 *  Layout-only (ADR 0009): breakpoints drive LAYOUT, never input detection —
 *  mouse and touch handlers stay dual-bound everywhere regardless of this value.
 *  SSR/no-`matchMedia` environments default to landscape (the richer layout). */
export function useIsPortrait(): boolean {
    const [isPortrait, setIsPortrait] = useState(() => {
        if (typeof window === "undefined" || !window.matchMedia) return false;
        return window.matchMedia(PORTRAIT_QUERY).matches;
    });

    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return;
        const mql = window.matchMedia(PORTRAIT_QUERY);
        const onChange = () => setIsPortrait(mql.matches);
        onChange();
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, []);

    return isPortrait;
}
