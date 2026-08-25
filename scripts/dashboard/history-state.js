/**
 * The single owner of History's shared mutable state (#2625).
 *
 * Two pieces, and this file is the ONLY place either is declared:
 *
 * - `state` — the current query slice (dataset, metric, split, date range,
 *   chip filters, table sort). Exported as the object itself because it is
 *   read on every render and written by the filter bar and the metric table's
 *   header clicks; wrapping thirty fields in accessors would buy nothing that
 *   "one declaration site, named owner" does not already buy. Every writer is
 *   listed below, and adding one means adding it here.
 * - `META` — `/api/meta`'s payload, REASSIGNED once at bootstrap rather than
 *   mutated, so it goes through accessors: a plain `export let` would leave
 *   importers holding a live binding they could rebind, and there would be no
 *   single place to ask "has the store answered yet?".
 *
 * Writers of `state`, exhaustively:
 *   history-filters.js     table / metric / split / from / to / filters / sort
 *   history-metrics-table.js  sort / sortDir (header clicks)
 *   history-boot.js        from / to / table (defaults, then URL params)
 *   history-filters.js     metric / split (coerced to a valid value for META)
 */

export const state = {
    table: "agent_runs",
    metric: "total_seconds",
    split: "role",
    from: "",
    to: "",
    filters: {},
    sort: null,
    sortDir: -1,
};

let META = null;

/** `/api/meta`'s payload, or `null` while the store has not answered. */
export const getMeta = () => META;

/** Called exactly once, by history-boot.js, after `/api/meta` resolves. */
export const setMeta = (meta) => {
    META = meta;
};
