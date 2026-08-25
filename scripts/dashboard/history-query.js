import { state } from "./history-state.js";

/**
 * The aggregate query seam (#2625): every History chart reads the telemetry
 * store through `POST /api/q`, scoped by the current `state` slice.
 */
export async function q(body) {
    const res = await fetch("/api/q", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            table: state.table,
            from: state.from || undefined,
            to: state.to || undefined,
            filters: state.filters,
            metric: state.metric,
            ...body,
        }),
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error);
    return j;
}

/** `?from=&to=` for the narrative routes, which take the range as query. */
export const dayQ = () =>
    `from=${encodeURIComponent(state.from)}&to=${encodeURIComponent(state.to)}`;
