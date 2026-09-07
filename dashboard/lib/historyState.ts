import { useSyncExternalStore } from "react";
import type { HistoryMeta } from "./historyPayload";

/**
 * History's shared query slice, as a STORE (PRD #3148 S3) — ported from
 * `scripts/dashboard/history-state.js` (#2625/#2635).
 *
 * Two pieces, and this file is the only place either is declared:
 *
 * - the SLICE — dataset, metric, split, date range, chip filters, and the
 *   metric table's column sort. One object, one writer function, because it is
 *   read on every render and written from the filter bar, the metric table's
 *   header clicks and the URL restore.
 * - META — `/api/meta`'s payload, published once at bootstrap. It goes through
 *   accessors so there is a single place to ask "has the store answered yet?",
 *   which is what the `r` shortcut tests before refreshing a view that has
 *   never loaded.
 *
 * A STORE rather than component state, for the same reason `loopStatus.ts` is
 * one: the keyboard layer refreshes History without going through React
 * (`shortcuts.ts`), and a second copy of "the current slice" is the thing that
 * disagrees with the URL after a keystroke.
 *
 * NO `/api/*` STRING APPEARS HERE. This module is imported by the keyboard
 * layer, which is chrome and therefore statically reachable from the React
 * entry; `telemetry-serve.test.ts` crawls that graph and asserts no DB-backed
 * route is named in it. The fetching lives in `historyQuery.ts`, which is
 * reachable only from the lazy History chunk.
 */

export interface HistorySlice {
    /** The fact table every query reads. */
    table: string;
    /** The measure the charts draw. */
    metric: string;
    /** The dimension the charts break the measure down by. */
    split: string;
    /** `YYYY-MM-DD`, inclusive; `""` means "the store's own minimum". */
    from: string;
    to: string;
    /** dimension → the values selected as chips. Absent key = no filter. */
    filters: Record<string, string[]>;
    /** The metric table's sort column, or `null` for "the current metric". */
    sort: string | null;
    /** `-1` descending, `1` ascending. */
    sortDir: number;
}

export const DEFAULT_SLICE: HistorySlice = {
    table: "agent_runs",
    metric: "total_seconds",
    split: "role",
    from: "",
    to: "",
    filters: {},
    sort: null,
    sortDir: -1,
};

/**
 * How each field crosses the URL — DECLARED, never inferred from the field's
 * live value.
 *
 * The vanilla round trip read the type off `state[key]`'s current value, and
 * documented its own footgun: a field whose default is `null` but which is
 * meant to hold an object restores as a plain string on its very first load,
 * because `null` is indistinguishable from "a string field that happens to be
 * empty". `sort` is exactly that shape and dodged it only by never holding an
 * object. A declared table cannot have that ambiguity — and because it is
 * `Record<keyof HistorySlice, …>`, `tsc` reds on a field added to the slice
 * without a codec, which is the property the walk-the-keys version was written
 * to buy in the first place.
 */
type Codec = "string" | "number" | "json";

const CODECS: Record<keyof HistorySlice, Codec> = {
    table: "string",
    metric: "string",
    split: "string",
    from: "string",
    to: "string",
    filters: "json",
    sort: "string",
    sortDir: "number",
};

/** Every field the URL round trip walks — derived from `CODECS`, so a slice
 *  field with no codec is not merely untested, it does not compile. */
export const SLICE_KEYS = Object.keys(CODECS) as (keyof HistorySlice)[];

let slice: HistorySlice = { ...DEFAULT_SLICE };
let meta: HistoryMeta | null = null;

const listeners = new Set<() => void>();

const publish = (): void => {
    for (const fn of listeners) fn();
};

export const getSlice = (): HistorySlice => slice;

export function subscribeToHistoryState(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

/** The slice, as a subscription. */
export const useHistorySlice = (): HistorySlice =>
    useSyncExternalStore(subscribeToHistoryState, getSlice);

/**
 * The ONE writer. A patch, never a mutation in place: every reader is a React
 * subscriber comparing snapshots by identity, so a mutated object would leave
 * the page showing the previous render of the new state.
 */
export function setSlice(patch: Partial<HistorySlice>): void {
    slice = { ...slice, ...patch };
    publish();
}

/** `/api/meta`'s payload, or `null` while the store has not answered. */
export const getHistoryMeta = (): HistoryMeta | null => meta;

export function setHistoryMeta(next: HistoryMeta | null): void {
    meta = next;
    publish();
}

export const useHistoryMeta = (): HistoryMeta | null =>
    useSyncExternalStore(subscribeToHistoryState, getHistoryMeta);

/** Test-only: drop the slice and META, so a suite does not inherit the
 *  previous file's dataset or its answered-store flag. */
export function resetHistoryState(): void {
    slice = { ...DEFAULT_SLICE };
    meta = null;
    listeners.clear();
}

/**
 * The slice → the URL (#2635 AC: "History's filter state round-trips through
 * the URL — loading a produced URL restores exactly that state").
 *
 * A `null` / `""` value, or an empty `filters`, is DELETED from the param set
 * rather than written empty — that is what keeps a page with no filters at all
 * from producing `?filters=%7B%7D` and every other default's clutter on first
 * share. Params this slice does not own (`view`, `theme`) are never touched,
 * so the caller passes the CURRENT query in as the base.
 */
export function sliceToParams(
    params: URLSearchParams,
    from: HistorySlice = slice
): URLSearchParams {
    for (const key of SLICE_KEYS) {
        const value = from[key];
        if (value === null || value === "") {
            params.delete(key);
            continue;
        }
        if (CODECS[key] === "json") {
            if (Object.keys(value as object).length === 0) params.delete(key);
            else params.set(key, JSON.stringify(value));
            continue;
        }
        params.set(key, String(value));
    }
    return params;
}

/**
 * The inverse — every field `params` is silent about keeps its current value.
 *
 * A malformed `filters` (a hand-edited URL, or JSON from a future slice shape
 * this version does not understand) is skipped rather than thrown: a bad link
 * degrades to "the default filter", never a wedged page.
 */
export function paramsToSlice(
    params: URLSearchParams,
    from: HistorySlice = slice
): HistorySlice {
    const next: HistorySlice = { ...from };
    for (const key of SLICE_KEYS) {
        if (!params.has(key)) continue;
        const raw = params.get(key)!;
        switch (CODECS[key]) {
            case "json": {
                try {
                    const parsed: unknown = JSON.parse(raw);
                    if (parsed && typeof parsed === "object")
                        next.filters = parsed as HistorySlice["filters"];
                } catch {
                    // Keep the current value rather than wedge the page.
                }
                break;
            }
            case "number": {
                const n = Number(raw);
                if (!Number.isNaN(n)) next.sortDir = n;
                break;
            }
            default:
                (next[key] as string) = raw;
        }
    }
    return next;
}

/**
 * Restore from the URL and apply, in one publish.
 *
 * Guarded on `location`/`history` existing rather than assumed, for the same
 * reason `syncUrlFromSlice` is: this module is imported by tests that install a
 * `document` without a `location`, and a host with no history navigation has
 * nothing to restore FROM — skipping is the correct behaviour there, not only
 * the test-safe one.
 */
export function restoreSliceFromUrl(params: URLSearchParams): void {
    setSlice(paramsToSlice(params));
}

/**
 * The slice → the address bar. `replaceState`, not `pushState`: a filter tweak
 * is not a browser-history stop the Back button should walk one click at a
 * time. Every OTHER param is preserved by building on the current query.
 */
export function syncUrlFromSlice(): void {
    if (typeof location === "undefined" || typeof history === "undefined")
        return;
    const next = sliceToParams(new URLSearchParams(location.search));
    history.replaceState(null, "", `?${next}`);
}

/**
 * The slice, corrected against what META actually offers.
 *
 * A dataset carries its own dimensions and metrics, so a metric or split that
 * is legal for `agent_runs` may not exist on `llm`, and a bookmarked link can
 * name either. Every correction is the vanilla one: an unknown dataset falls
 * back to `agent_runs`, an unknown metric to the dataset's first, an unknown
 * split to its third dimension (the first two are `day` and the id column) or
 * its first. Returns the SAME object when nothing needed correcting, so a
 * caller can publish unconditionally without looping the store.
 */
export function coerceSlice(
    current: HistorySlice,
    m: HistoryMeta
): HistorySlice {
    const table = m.dimensions[current.table] ? current.table : "agent_runs";
    const dims = m.dimensions[table] ?? [];
    const mets = Object.keys(m.metrics[table] ?? {});
    const metric = mets.includes(current.metric) ? current.metric : mets[0];
    const split = dims.includes(current.split)
        ? current.split
        : (dims[2] ?? dims[0]);
    if (
        table === current.table &&
        metric === current.metric &&
        split === current.split
    )
        return current;
    return { ...current, table, metric, split };
}
