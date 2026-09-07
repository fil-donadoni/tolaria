import { useEffect, useSyncExternalStore } from "react";
import { setMetaLine } from "./metaLine";
import { seedColors } from "./historyColors";
import {
    fetchFamilies,
    fetchIssues,
    fetchMeta,
    fetchSessions,
    q,
} from "./historyQuery";
import {
    coerceSlice,
    getSlice,
    setHistoryMeta,
    setSlice,
    paramsToSlice,
    syncUrlFromSlice,
} from "./historyState";
import type {
    FamiliesPayload,
    IssuesPayload,
    MetricRow,
    SessionsPayload,
} from "./historyPayload";

/**
 * History's ORCHESTRATOR (PRD #3148 S3) — one store that turns the current
 * slice into the four chart cards plus the three narrative cards, ported from
 * `scripts/dashboard/history-boot.js` + `history-refresh.js` (#2625/#2635).
 *
 * ── TWO INDEPENDENT ERROR CHANNELS, exactly as before ─────────────────────
 *
 * `bootstrapError` is "there is no telemetry store" — `/api/meta` rejected, or
 * answered with an `error`. It is the #2519 case, and the whole reason History
 * is loaded through a dynamic import: the Now view is already polling by the
 * time this fails, and nothing here can take it down.
 *
 * Below that, the narrative reads (`/api/issues`, `/api/sessions`,
 * `/api/families`) and the chart reads (`/api/q`, three of them) fail
 * SEPARATELY. A failed narrative read leaves the charts drawn and vice versa —
 * one flaky route must not blank six cards.
 *
 * ── WHAT THE PORT DROPPED, AND WHY ────────────────────────────────────────
 *
 * `onThemeChange(refresh)`. The vanilla charts re-rendered on a theme toggle
 * because that was the cheapest way to be sure. Every colour a React chart
 * draws with is a `var(--…)`, resolved by the browser at paint time against
 * whichever token block `data-theme` selects, so a toggle repaints without
 * React hearing about it at all. Re-running six network reads to change a hue
 * was never buying anything the cascade does not.
 *
 * The card TITLES and SUBTITLES no longer live here either. The vanilla
 * orchestrator wrote `#ts-title`, `#rank-title`, `#rank-sub`, `#tbl-sub`,
 * `#fam-title` and `#fam-sub` itself, BEFORE awaiting the queries, so a card
 * kept its heading when its query then failed (#2633/#2634/#2839). In a React
 * tree that ordering is not something to arrange: a card renders its own
 * static copy from the glossary on every render, including the render where
 * `error` is set. The property the ids existed to buy is structural now.
 */

export interface HistoryChartData {
    /** `groupBy: ["day", split]` — the "Over time" card. */
    perDay: MetricRow[];
    /** `groupBy: [split]` — the ranking card and the metric table. */
    bySplit: MetricRow[];
    /** The metric columns `bySplit` carries, in the server's own order. */
    metrics: string[];
    /** `groupBy: []` — the one totals row behind the tiles. */
    total: MetricRow;
    /** The slice these rows were fetched FOR. A chart must draw the dataset,
     *  split and metric its own rows were grouped by, never the one the picker
     *  has since moved to — otherwise a slow query paints the previous
     *  dataset's rows under the new dataset's column names. */
    table: string;
    split: string;
    metric: string;
}

export interface HistoryNarrativeData {
    issues: IssuesPayload;
    sessions: SessionsPayload;
    families: FamiliesPayload;
}

export interface HistorySnapshot {
    /** `false` until `/api/meta` has answered one way or the other. */
    booted: boolean;
    /** Set when the store itself could not be read — nothing else renders. */
    bootstrapError: string | null;
    charts: HistoryChartData | null;
    chartsError: string | null;
    narrative: HistoryNarrativeData | null;
    narrativeError: string | null;
}

const EMPTY: HistorySnapshot = {
    booted: false,
    bootstrapError: null,
    charts: null,
    chartsError: null,
    narrative: null,
    narrativeError: null,
};

let snapshot: HistorySnapshot = EMPTY;
const listeners = new Set<() => void>();

function publish(patch: Partial<HistorySnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const fn of listeners) fn();
}

export const getHistorySnapshot = (): HistorySnapshot => snapshot;

export function subscribeToHistory(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

const messageOf = (e: unknown): string =>
    e instanceof Error ? e.message : String(e);

/** The header line for a store that answered — the counts, the day range and
 *  when the last ingest ran, which together say how current every figure
 *  below it is. */
function metaLineFor(meta: {
    counts: { spans: number; llm: number; agent_runs: number };
    range: { min_day: string; max_day: string };
    lastIngest: string | number;
}): string {
    return (
        `${meta.counts.spans.toLocaleString()} spans · ` +
        `${meta.counts.llm.toLocaleString()} messages · ` +
        `${meta.counts.agent_runs.toLocaleString()} agent runs · ` +
        `${meta.range.min_day} → ${meta.range.max_day} · ` +
        `ingested ${new Date(Number(meta.lastIngest)).toLocaleString()}`
    );
}

/**
 * Monotonic per refresh — a response from an older refresh than the newest one
 * in flight is dropped, so a slow query on the previous dataset can never
 * paint over a fresher one. Same latch, and the same reason, as
 * `loopStatus.ts`'s `refreshSeq`.
 */
let refreshSeq = 0;

/** The narrative half: three row-oriented reads, one error channel. */
async function refreshNarrative(seq: number): Promise<void> {
    try {
        const [issues, sessions, families] = await Promise.all([
            fetchIssues(),
            fetchSessions(),
            fetchFamilies(),
        ]);
        if (seq !== refreshSeq) return;
        publish({
            narrative: { issues, sessions, families },
            narrativeError: null,
        });
    } catch (e) {
        if (seq !== refreshSeq) return;
        publish({ narrativeError: messageOf(e) });
    }
}

/** The chart half: the colour seeding, then the three aggregate reads. */
async function refreshCharts(seq: number): Promise<void> {
    const { table, split, metric } = getSlice();
    try {
        // Seeded BEFORE the first paint: seeding afterwards draws the chart
        // once with fallback hues and again with the stable ones.
        await seedColors(table, split);
        const [perDay, bySplit, total] = await Promise.all([
            q({ groupBy: ["day", split], limit: 5000 }),
            q({ groupBy: [split], limit: 500 }),
            q({ groupBy: [] }),
        ]);
        if (seq !== refreshSeq) return;
        publish({
            charts: {
                perDay: perDay.rows,
                bySplit: bySplit.rows,
                metrics: bySplit.metrics,
                total: total.rows[0] ?? {},
                table,
                split,
                metric,
            },
            chartsError: null,
        });
    } catch (e) {
        if (seq !== refreshSeq) return;
        publish({ chartsError: messageOf(e) });
    }
}

/**
 * Re-run both halves against the current slice, and write the slice into the
 * URL. The ONE choke point where "the slice changed" becomes "the URL says
 * so": every writer already calls this straight after mutating, so there is no
 * second call site at each writer to forget.
 */
export async function refreshHistory(): Promise<void> {
    const seq = ++refreshSeq;
    syncUrlFromSlice();
    await Promise.all([refreshNarrative(seq), refreshCharts(seq)]);
}

let bootstrapped = false;

/**
 * The first read. `/api/meta` decides the default date range and validates the
 * slice a bookmarked URL asked for; only then does anything else run.
 *
 * Idempotent, because React 19 StrictMode double-invokes effects in
 * development and a second bootstrap would issue every read twice.
 */
export async function bootstrapHistory(
    params: URLSearchParams = new URLSearchParams(
        typeof location === "undefined" ? "" : location.search
    )
): Promise<void> {
    if (bootstrapped) return;
    bootstrapped = true;
    let meta;
    try {
        meta = await fetchMeta();
    } catch (e) {
        // #2519's acceptance criterion: no telemetry store leaves History
        // empty and says so, and never touches the Now view.
        setMetaLine(
            `no telemetry store: ${messageOf(e)} — run "bun run telemetry:ingest"`
        );
        publish({ booted: true, bootstrapError: messageOf(e) });
        return;
    }
    setHistoryMeta(meta);
    // The store's own range first, so an explicit `?from=` always wins over
    // it; then the correction pass, so a stale link cannot wedge the page on a
    // dataset or metric this store does not have.
    const withRange = {
        ...getSlice(),
        from: meta.range?.min_day ?? "",
        to: meta.range?.max_day ?? "",
    };
    setSlice(coerceSlice(paramsToSlice(params, withRange), meta));
    setMetaLine(metaLineFor(meta));
    publish({ booted: true, bootstrapError: null });
    await refreshHistory();
}

/** Test-only: drop the bootstrap latch and every fetched payload. */
export function resetHistoryData(): void {
    bootstrapped = false;
    refreshSeq = 0;
    snapshot = EMPTY;
    listeners.clear();
}

/** The snapshot, with the bootstrap run for as long as the caller is
 *  mounted. */
export function useHistoryData(): HistorySnapshot {
    const state = useSyncExternalStore(subscribeToHistory, getHistorySnapshot);
    useEffect(() => {
        void bootstrapHistory();
    }, []);
    return state;
}
