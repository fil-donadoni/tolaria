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

export function initTabs(params) {
    showView(viewFromParams(params));
    for (const v of VIEWS) {
        document.getElementById(`tab-${v}`).addEventListener("click", () => {
            showView(v);
            const next = new URLSearchParams(location.search);
            next.set("view", v);
            history.replaceState(null, "", `?${next}`);
        });
    }
}
