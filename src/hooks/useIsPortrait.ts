import { useViewportMode } from "./useViewportMode";

/** Single high seam (#335) for the controller's portrait/landscape layout
 *  switch. Portrait collapses the right control column into a fixed bottom
 *  action bar + bottom sheet and drops the battlefield right gutter to 0;
 *  landscape keeps the reduced-desktop right column. Both the controller and the
 *  battlefield read THIS hook so the switch lives in one place rather than
 *  scattered breakpoint checks.
 *
 *  Layout-only (ADR 0009): breakpoints drive LAYOUT, never input detection —
 *  mouse and touch handlers stay dual-bound everywhere regardless of this value.
 *  SSR/no-`matchMedia` environments default to landscape (the richer layout).
 *
 *  Since #1763 this is a thin projection of {@link useViewportMode}: the media
 *  query that used to live here IS that hook's `"portrait"` mode, so the boolean
 *  is exactly `mode === "portrait"` — the old semantics unchanged, for every
 *  caller. The new `"landscape-compact"` mode maps to `false` here, i.e.
 *  landscape phones keep rendering the desktop layout until #1768 / #1769 give
 *  them their own; a caller that must tell those two apart reads
 *  `useViewportMode` directly. */
export function useIsPortrait(): boolean {
    return useViewportMode() === "portrait";
}
