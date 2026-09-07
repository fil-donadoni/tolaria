import { getSlice } from "./historyState";
import type {
    FamiliesPayload,
    HistoryMeta,
    IssuesPayload,
    QueryResult,
    RunsPayload,
    SessionsPayload,
} from "./historyPayload";

/**
 * History's TRANSPORT (PRD #3148 S3) — ported from
 * `scripts/dashboard/history-query.js` and the fetch sites in
 * `history-boot.js` / `history-narrative.js` / `history-drilldown.js` (#2625).
 *
 * THIS IS THE STORE-BACKED HALF. Every route named below reads `telemetry.db`,
 * which is exactly why nothing in the Now graph may reach this module:
 * `telemetry-serve.test.ts` crawls the static import graph from
 * `dashboard/main.tsx` and asserts no file in it names a DB route (PRD #2621
 * D1, #2519 — the Now panel must come up with no store at all). This file is
 * reachable only from the lazily-imported History chunk, and the guard is what
 * keeps that true as the tree grows.
 */

const json = async <T>(res: Response): Promise<T> => {
    const body = (await res.json()) as T & { error?: string };
    if (body.error) throw new Error(body.error);
    return body;
};

/** The store's own vocabularies and range. The first read History makes, and
 *  the one whose failure means "there is no telemetry store". */
export const fetchMeta = async (): Promise<HistoryMeta> =>
    json<HistoryMeta>(await fetch("/api/meta"));

/**
 * The aggregate seam: every History chart reads the store through here,
 * scoped by the current slice. The caller names only what it varies —
 * `groupBy` and `limit` — so a chart cannot accidentally query a different
 * dataset or date range from the one the filter bar is showing.
 */
export async function q(body: {
    groupBy: string[];
    limit?: number;
}): Promise<QueryResult> {
    const slice = getSlice();
    const res = await fetch("/api/q", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
            table: slice.table,
            from: slice.from || undefined,
            to: slice.to || undefined,
            filters: slice.filters,
            metric: slice.metric,
            ...body,
        }),
    });
    return json<QueryResult>(res);
}

/**
 * The colour-seeding query (`historyColors.ts`) — deliberately NOT `q()`.
 *
 * Slots are seeded from an UNFILTERED ranking on the dataset's canonical count
 * metric, so a value keeps its hue whichever metric, filter or date range is
 * selected. Routing it through `q()` would scope it by the current slice and
 * repaint the chart every time a filter changed the ordering, which is the one
 * thing the seeding exists to prevent.
 */
export async function seedQuery(
    table: string,
    metric: string,
    dim: string
): Promise<QueryResult> {
    const res = await fetch("/api/q", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table, metric, groupBy: [dim], limit: 500 }),
    });
    return json<QueryResult>(res);
}

/** `?from=&to=` — the narrative routes take the range as a query string. */
const dayQ = (): string => {
    const { from, to } = getSlice();
    return `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
};

export const fetchIssues = async (): Promise<IssuesPayload> =>
    json<IssuesPayload>(await fetch(`/api/issues?${dayQ()}`));

export const fetchSessions = async (): Promise<SessionsPayload> =>
    json<SessionsPayload>(await fetch(`/api/sessions?${dayQ()}`));

export const fetchFamilies = async (): Promise<FamiliesPayload> =>
    json<FamiliesPayload>(await fetch(`/api/families?${dayQ()}`));

/** A row's drill-down: the subagent runs under one issue, or one session. */
export const fetchRunsForIssue = async (issue: number): Promise<RunsPayload> =>
    json<RunsPayload>(await fetch(`/api/runs?issue=${issue}`));

export const fetchRunsForSession = async (
    session: string
): Promise<RunsPayload> =>
    json<RunsPayload>(
        await fetch(`/api/runs?session=${encodeURIComponent(session)}`)
    );
