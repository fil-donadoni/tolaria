import { useSyncExternalStore } from "react";

/** Mirrors the `deck-source-dock:` CSS custom variant (`src/index.css`) in
 *  JS, for components that need the SAME predicate to gate a BEHAVIOURAL
 *  fold rather than a class list (issue #2585 review finding #3 — reclaiming
 *  height for the deck pane while a search is active means folding the ADD
 *  BASIC bar in dock layout, and that decision has to be made in JS, not
 *  CSS).
 *
 *  Keep this query text byte-for-byte identical to `src/index.css`'s
 *  `@custom-variant deck-source-dock (@media ...)`. The two are independent
 *  copies — Tailwind's `@custom-variant` syntax has no JS-consumable form —
 *  so a change to one without the other desynchronises them exactly the way
 *  `compact-chrome:` / `useViewportMode()` already warn they must not
 *  (`src/index.css`'s comment on that variant).
 */
export const DECK_SOURCE_DOCK_QUERY =
    "(orientation: landscape) and (min-width: 1024px) and (min-height: 501px)";

function subscribe(onStoreChange: () => void): () => void {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mql = window.matchMedia(DECK_SOURCE_DOCK_QUERY);
    mql.addEventListener("change", onStoreChange);
    return () => mql.removeEventListener("change", onStoreChange);
}

function getSnapshot(): boolean {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(DECK_SOURCE_DOCK_QUERY).matches;
}

function getServerSnapshot(): boolean {
    return false;
}

/** `true` only at the exact viewport shape `deck-source-dock:` targets —
 *  landscape, >=1024px wide, >=501px tall. Callers must ALSO check whether a
 *  source panel was actually supplied (`Boolean(sourcePanel)`): the CSS
 *  variant only ever applies inside the `sourcePanel &&` branch
 *  (`deck-builder-shell.tsx`, review finding #5), and this hook has no way to
 *  know that on its own — it is a pure viewport predicate, reused as-is by
 *  Limited would wrongly fold chrome nothing there ever measures. */
export function useDeckSourceDock(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
