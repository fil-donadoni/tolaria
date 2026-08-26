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

/**
 * The URL round trip (#2635 AC: "the view and History's filter state
 * round-trip through the URL — loading a produced URL restores exactly that
 * state").
 *
 * `stateToParams`/`paramsToState` are the ONLY two functions that know how
 * `state` becomes a query string and back, and BOTH walk `Object.keys(state)`
 * / `Object.entries(state)` at call time rather than naming `table`,
 * `metric`, … by hand. That is deliberate, not stylistic: a hand-listed
 * serializer passes every test written against today's fields and silently
 * drops the NEXT one — the exact shape `history-boot.js` shipped with
 * before this ticket, restoring `table`/`metric`/`split`/`from`/`to` from the
 * URL while `filters` (the chip selections) and `sort`/`sortDir` (the Table
 * card's column sort) were never round-tripped at all, because the loop that
 * did the restoring named five of the eight fields by hand. Deriving from
 * `state`'s own keys means a ninth field added to the literal above is
 * covered the moment it is declared — no second edit, here or in
 * `shortcuts.js`, to remember.
 *
 * Three type shapes exist in `state`, and each needs its own round trip:
 *   - **string** (`table`/`metric`/`split`/`from`/`to`, and `sort` once set) —
 *     stored verbatim.
 *   - **number** (`sortDir`) — `URLSearchParams` values are always strings;
 *     restoring must convert back or `state.sortDir === -1` (every read site)
 *     silently stops matching a restored `"-1"`.
 *   - **plain object** (`filters`) — JSON round trip. `typeof null ===
 *     "object"` is the footgun here: `sort`'s own default is `null`, so every
 *     branch below checks `!== null` before trusting `typeof value ===
 *     "object"`, or a freshly-loaded page would try to `JSON.parse` the
 *     literal string `"null"` into `state.sort` instead of leaving it a
 *     string.
 *
 * A `null`/`undefined`/`""` value, or an empty `{}`, is DELETED from the
 * param set rather than written as an empty string — that is what keeps a
 * page loaded with no filters at all from producing `?filters=%7B%7D` and
 * every other field's default clutter on first share.
 */
export function stateToParams(params) {
    for (const [key, value] of Object.entries(state)) {
        if (value === null || value === undefined || value === "") {
            params.delete(key);
            continue;
        }
        if (typeof value === "object") {
            if (Object.keys(value).length === 0) params.delete(key);
            else params.set(key, JSON.stringify(value));
            continue;
        }
        params.set(key, String(value));
    }
    return params;
}

/**
 * The inverse of `stateToParams` — restores `state` in place from whatever
 * keys `params` actually carries, leaving every field `params` is silent
 * about at its current value (its default, unless a caller already changed
 * it). The TYPE to restore as is read off the field's CURRENT value in
 * `state`, not off a second, hand-maintained schema: a number stays a number,
 * a plain object round-trips through JSON, everything else (including
 * `sort`'s `null` default, explicitly excluded from the object branch) is
 * copied as a plain string.
 *
 * A malformed `filters` value (a hand-edited URL, or JSON from a future
 * `state` shape this version does not understand) is caught and skipped
 * rather than left to throw out of `history-boot.js` — a bad link degrades to
 * "the default filter", never a wedged page.
 */
export function paramsToState(params) {
    for (const key of Object.keys(state)) {
        if (!params.has(key)) continue;
        const raw = params.get(key);
        const current = state[key];
        if (current !== null && typeof current === "object") {
            try {
                state[key] = JSON.parse(raw);
            } catch {
                // Malformed JSON on a hand-edited/stale URL — keep the
                // current value rather than wedge the page.
            }
        } else if (typeof current === "number") {
            const n = Number(raw);
            if (!Number.isNaN(n)) state[key] = n;
        } else {
            state[key] = raw;
        }
    }
    return state;
}
