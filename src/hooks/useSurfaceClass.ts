import { useSyncExternalStore } from "react";
import { PORTRAIT_QUERY, LANDSCAPE_COMPACT_QUERY } from "./useViewportMode";

/** The three DEVICE classes an overlay has to choose a shape for.
 *
 *  - `"phone"`   — a phone in either orientation. Overlays are bottom SHEETS:
 *                  the viewport is too small for an anchored popover to have
 *                  anywhere to go, and the thumb reaches the bottom edge.
 *  - `"tablet"`  — a touch device that is NOT phone-shaped (iPad portrait and
 *                  landscape, a touch laptop). Room for an anchored popover,
 *                  but every control still pays the coarse-pointer 44px rung
 *                  (ADR 0101 §2).
 *  - `"desktop"` — a fine-pointer device.
 */
export type SurfaceClass = "phone" | "tablet" | "desktop";

/**
 * Why this is NOT `useViewportMode()` (issue #2585).
 *
 * `useViewportMode()` answers a LAYOUT question — "does this screen get the
 * portrait column, the landscape strip, or the full split?" — and its
 * `"desktop"` bucket is deliberately everything that is neither phone shape.
 * **Tablet portrait 820×1180 is 820px wide, so it lands in `"desktop"`**, which
 * is exactly why the deckbuilder's `compact-chrome` fold never engaged there
 * and the card-pile strip stayed starved (`scripts/ui-gate/budgets.json`,
 * `deck-builder @ 820x1180x2`).
 *
 * That bucket is right for LAYOUT (a tablet really does get the two-pane split)
 * and wrong for OVERLAY SHAPE (a tablet is not a desktop: it has no hover, and
 * its controls are 44px tall). The two questions need two predicates; deriving
 * one from the other is what conflated them in the first place. The Peek Panel's
 * `usePeekPanelLayout` has the same conflation in the other direction — it
 * splits two ways and files phone-landscape with desktop.
 *
 * The discriminator for tablet-vs-desktop is `(pointer: coarse)` — the SAME
 * query ADR 0101 §2's control-height rung uses (`src/index.css`), so a device
 * that pays the 44px rung is by construction a device this hook calls touch.
 * Deliberately not a width bound: an iPad Pro in landscape is 1366px wide and
 * is not a desktop, and a 900px-wide desktop window is not a tablet.
 *
 * Layout-only (ADR 0009): this drives which SHAPE an overlay takes, never input
 * detection — pointer and touch handlers stay dual-bound regardless.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribe(onStoreChange: () => void): () => void {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mqls = [
        window.matchMedia(PORTRAIT_QUERY),
        window.matchMedia(LANDSCAPE_COMPACT_QUERY),
        window.matchMedia(COARSE_POINTER_QUERY),
    ];
    for (const mql of mqls) mql.addEventListener("change", onStoreChange);
    return () => {
        for (const mql of mqls)
            mql.removeEventListener("change", onStoreChange);
    };
}

function getSnapshot(): SurfaceClass {
    if (typeof window === "undefined" || !window.matchMedia) return "desktop";
    if (
        window.matchMedia(PORTRAIT_QUERY).matches ||
        window.matchMedia(LANDSCAPE_COMPACT_QUERY).matches
    )
        return "phone";
    if (window.matchMedia(COARSE_POINTER_QUERY).matches) return "tablet";
    return "desktop";
}

/** SSR / no-`matchMedia`: `"desktop"`, matching `useViewportMode`'s default. */
function getServerSnapshot(): SurfaceClass {
    return "desktop";
}

export function useSurfaceClass(): SurfaceClass {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
