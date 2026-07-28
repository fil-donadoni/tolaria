import { useSyncExternalStore } from "react";

/** The three layout regimes the gameplay UI can render in.
 *
 *  - `"portrait"`          — phone held upright: bottom action bar + sheet.
 *  - `"landscape-compact"` — phone held sideways: a wide but VERY short
 *                            viewport. Today it renders exactly like
 *                            `"desktop"`; the dedicated landscape layout lands
 *                            in issues #1768 / #1769, which consume this seam.
 *  - `"desktop"`           — everything else (tablets, laptops, monitors).
 */
export type ViewportMode = "portrait" | "landscape-compact" | "desktop";

/** The `md:` breakpoint (Tailwind default = 768px). Portrait layout applies
 *  strictly BELOW it; at/above it we are in "reduced desktop" territory even on
 *  a touch device held in landscape. Unchanged since #335 — `useIsPortrait` is
 *  now defined as `mode === "portrait"`, so this query alone still decides it. */
const PORTRAIT_QUERY = "(orientation: portrait) and (max-width: 767px)";

/** Landscape phones. The discriminator is HEIGHT, not width: a sideways phone
 *  is wide (typically 667–932px, i.e. above the `md:` width breakpoint) but
 *  extremely short — 375–430px of usable height on the whole current phone
 *  range (iPhone SE 320, iPhone 15 Pro Max 430, Pixel 8 Pro 448). A width-based
 *  query cannot separate it from a small laptop; a height one can.
 *
 *  `max-height: 500px` sits above every phone in that range and below every
 *  laptop/tablet in landscape (iPad mini 744, the shortest common laptop
 *  ~600–800), so it selects landscape phones and nothing else. Deliberately NOT
 *  paired with a width bound: a landscape phone must not fall back to desktop
 *  just because it is wide, which is the exact bug (#1758) this hook exists to
 *  make fixable. */
const LANDSCAPE_COMPACT_QUERY =
    "(orientation: landscape) and (max-height: 500px)";

/** Both queries are read on every snapshot, so a single subscription covering
 *  both `MediaQueryList`s is all the hook ever installs — regardless of how
 *  many components call it or how often they re-render (module-level
 *  `subscribe` / `getSnapshot` identities never change, so React never
 *  resubscribes). */
function subscribe(onStoreChange: () => void): () => void {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mqls = [
        window.matchMedia(PORTRAIT_QUERY),
        window.matchMedia(LANDSCAPE_COMPACT_QUERY),
    ];
    for (const mql of mqls) mql.addEventListener("change", onStoreChange);
    return () => {
        for (const mql of mqls)
            mql.removeEventListener("change", onStoreChange);
    };
}

function getSnapshot(): ViewportMode {
    if (typeof window === "undefined" || !window.matchMedia) return "desktop";
    if (window.matchMedia(PORTRAIT_QUERY).matches) return "portrait";
    if (window.matchMedia(LANDSCAPE_COMPACT_QUERY).matches)
        return "landscape-compact";
    return "desktop";
}

/** SSR / no-`matchMedia`: default to `"desktop"` — the richer layout, and the
 *  value `useIsPortrait` has always returned there (`false`). */
function getServerSnapshot(): ViewportMode {
    return "desktop";
}

/** Single high seam (#335, widened in #1763) for the gameplay UI's layout
 *  switch. Every layout-varying component reads THIS hook so the switch lives
 *  in one place rather than scattered breakpoint checks.
 *
 *  Layout-only (ADR 0009): breakpoints drive LAYOUT, never input detection —
 *  mouse and touch handlers stay dual-bound everywhere regardless of this
 *  value.
 *
 *  `useSyncExternalStore` (React 19) rather than `useState` + `useEffect`: it
 *  gives a tear-free read during render, resyncs on subscribe (so a change that
 *  lands between first render and commit is not missed), and keeps the returned
 *  value referentially stable across re-renders for free. */
export function useViewportMode(): ViewportMode {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
