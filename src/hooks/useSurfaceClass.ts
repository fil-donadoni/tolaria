import { useSyncExternalStore } from "react";
import { PORTRAIT_QUERY, LANDSCAPE_COMPACT_QUERY } from "./useViewportMode";

/** The three shapes an OVERLAY has to choose between, named after the thing
 *  each one is actually tested by (issue #2585 review finding 5).
 *
 *  - `"phone"`        — a phone-shaped viewport in either orientation
 *                       (`PORTRAIT_QUERY` or `LANDSCAPE_COMPACT_QUERY`).
 *                       Overlays are bottom SHEETS: there is nowhere for an
 *                       anchored popover to go, and the thumb reaches the
 *                       bottom edge.
 *  - `"roomy-coarse"` — room to anchor a popover, and the PRIMARY pointer is
 *                       coarse (`pointer: coarse`), so every control pays the
 *                       44px rung and nothing may depend on hover.
 *  - `"roomy-fine"`   — room to anchor a popover, primary pointer fine.
 *
 *  The names are deliberately NOT `tablet` / `desktop`. `(pointer: coarse)` is
 *  a pointer-CAPABILITY test, and a device-class name over it misleads the next
 *  reader: a desktop driving a touch monitor with no mouse, a TV/console
 *  browser and an unfolded foldable at 884×1104 all answer "coarse", while a
 *  touchscreen laptop does NOT (its primary pointer stays fine — only
 *  `any-pointer: coarse` would catch it). Everything this hook drives keys on
 *  the capability, which is why the behaviour is right; borrowing the value for
 *  a genuinely SIZE-shaped question would not be, and a name that says `tablet`
 *  is an invitation to do exactly that.
 */
export type SurfaceClass = "phone" | "roomy-coarse" | "roomy-fine";

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
 * That bucket is right for LAYOUT (a roomy touch screen really does get the
 * two-pane split) and wrong for OVERLAY SHAPE (it has no hover, and its
 * controls are 44px tall). The two questions need two predicates; deriving one
 * from the other is what conflated them in the first place. The Peek Panel's
 * `usePeekPanelLayout` has the same conflation in the other direction — it
 * splits two ways and files phone-landscape with desktop.
 *
 * **What the split is worth TODAY, stated plainly** (issue #2585 review finding
 * 4): the `"phone"` branch is the only one any consumer currently reads —
 * `deck-filters-button.tsx` gives `"phone"` a sheet and both roomy classes the
 * same popover. And because the two phone queries are re-exported verbatim from
 * `useViewportMode`, `surface === "phone"` is today IDENTICALLY
 * `useViewportMode() !== "desktop"`. So the shipped sheet/popover split is
 * exactly what reusing the old hook would have produced; what this hook adds is
 * the coarse/fine seam, which no consumer exercises yet. It is a capability
 * ahead of its first consumer — the deferred "zone toolbar collapses into the
 * bar" half of #2585 is the one that needs it (`docs/findings/`) — and it is
 * recorded as such rather than sold as delivered behaviour.
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
    if (typeof window === "undefined" || !window.matchMedia)
        return "roomy-fine";
    if (
        window.matchMedia(PORTRAIT_QUERY).matches ||
        window.matchMedia(LANDSCAPE_COMPACT_QUERY).matches
    )
        return "phone";
    if (window.matchMedia(COARSE_POINTER_QUERY).matches) return "roomy-coarse";
    return "roomy-fine";
}

/** SSR / no-`matchMedia`: the fine-pointer roomy surface, matching
 *  `useViewportMode`'s `"desktop"` default. */
function getServerSnapshot(): SurfaceClass {
    return "roomy-fine";
}

export function useSurfaceClass(): SurfaceClass {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
