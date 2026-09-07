/**
 * Which view is showing, as a store (PRD #3148 S1).
 *
 * The chosen view is a URL query parameter, not a variable: `?view=now` and
 * `?view=history` are shareable links people paste, and switching tabs
 * rewrites the query in place (`replaceState`, so the back button still leaves
 * the dashboard rather than walking a stack of tab clicks). Every OTHER
 * parameter — `table`, `metric`, `split`, `from`, `to`, `theme` — is
 * preserved.
 *
 * React renders the tabs, but it is NOT the only caller: the keyboard layer
 * (`scripts/dashboard/shortcuts.js`, #2635) switches views on `1`/`2` and
 * still reaches `switchView` through the bridge in
 * `scripts/dashboard/tabs.js`. One function changes which view is visible, so
 * a click and a keystroke can never disagree about what "switch to Now" does.
 */

export const VIEWS = ["now", "history"] as const;
export type View = (typeof VIEWS)[number];

/** `now` unless the URL says otherwise — the dashboard is operations-first. */
export const DEFAULT_VIEW: View = "now";

const listeners = new Set<() => void>();

export function viewFromParams(params: URLSearchParams): View {
    const v = params.get("view");
    return (VIEWS as readonly string[]).includes(v ?? "")
        ? (v as View)
        : DEFAULT_VIEW;
}

/** The URL is the state, so this reads it rather than caching a copy — two
 *  copies of "which view" is how a keystroke and a click come to disagree. */
export function getView(): View {
    return viewFromParams(new URLSearchParams(location.search));
}

export function switchView(view: View): void {
    const next = new URLSearchParams(location.search);
    next.set("view", view);
    history.replaceState(null, "", `?${next}`);
    for (const fn of listeners) fn();
}

export function subscribeToView(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    // The back/forward buttons and a pasted URL both change the query without
    // going through `switchView`.
    addEventListener("popstate", onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
        removeEventListener("popstate", onStoreChange);
    };
}
