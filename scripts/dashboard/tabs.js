/**
 * Now / History tab navigation (#2625).
 *
 * The chosen view is a URL query parameter, not a variable: `?view=now` and
 * `?view=history` are shareable links, and switching tabs rewrites the query
 * in place (`replaceState`, so the back button still leaves the dashboard
 * rather than walking a stack of tab clicks). Every OTHER parameter on the URL
 * — `table`, `metric`, `split`, `from`, `to`, `theme` — is preserved.
 *
 * The only state is the DOM (`hidden` on the views, `aria-selected` on the
 * tabs) plus the URL. Nothing here reads or writes History's `state`.
 */

export const VIEWS = ["now", "history"];

/** `now` unless the URL says otherwise — the dashboard is operations-first. */
export const DEFAULT_VIEW = "now";

export function viewFromParams(params) {
    const v = params.get("view");
    return VIEWS.includes(v) ? v : DEFAULT_VIEW;
}

function showView(view) {
    for (const v of VIEWS) {
        document.getElementById(`view-${v}`).hidden = v !== view;
        document
            .getElementById(`tab-${v}`)
            .setAttribute("aria-selected", String(v === view));
    }
}

/**
 * Show `view` and rewrite `?view=` in place — the one function that changes
 * which view is visible, so a tab click and a `1`/`2` keyboard shortcut
 * (`shortcuts.js`, #2635) can never disagree about what "switch to Now" does.
 * `replaceState`, not `pushState`, so the back button still leaves the
 * dashboard rather than walking a stack of tab switches.
 */
export function switchView(view) {
    showView(view);
    const next = new URLSearchParams(location.search);
    next.set("view", view);
    history.replaceState(null, "", `?${next}`);
}

export function initTabs(params) {
    showView(viewFromParams(params));
    for (const v of VIEWS) {
        document
            .getElementById(`tab-${v}`)
            .addEventListener("click", () => switchView(v));
    }
}
