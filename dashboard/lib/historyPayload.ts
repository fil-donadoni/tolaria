/**
 * The History view's payloads, typed (PRD #3148 S3).
 *
 * Everything the five store-backed routes return: `/api/meta` (the store's own
 * vocabularies and range), `/api/q` (the aggregate seam every chart reads),
 * and the three row-oriented narrative routes `/api/issues`, `/api/sessions`
 * and `/api/families`, plus `/api/runs` for a row's drill-down.
 *
 * MIRRORED, not imported, for the same reason `nowPayload.ts` states: the
 * source of these shapes is `scripts/telemetry-serve.ts`, a Node-typed module
 * that `tsconfig.dashboard.json` (a BROWSER program, no `@types/node`) cannot
 * check. What keeps the two honest is the fixture the component tests render
 * against — a field renamed upstream shows up as a figure that changed, not as
 * a type that silently widened.
 *
 * ── WHY THE ROWS ARE INDEX SIGNATURES ─────────────────────────────────────
 *
 * A `/api/q` row's KEYS are chosen at runtime: the caller names a `groupBy`
 * dimension and a metric, and the server returns one column per name. The set
 * of legal names is `/api/meta`'s own `dimensions` / `metrics` tables, which
 * this page reads rather than declares — the whole point of the dataset picker
 * is that adding a metric server-side needs no edit here. So the row type is
 * an index signature and the NAMES are validated against META at the point
 * they are chosen (`coerceSlice`, `historyState.ts`), which is the only place
 * that knowledge exists.
 */

/** One aggregate row: the grouped dimension values plus the metric columns. */
export type MetricRow = Record<string, string | number | null>;

export interface HistoryMeta {
    /** Dataset → its dimension columns, in the order the picker offers them. */
    dimensions: Record<string, string[]>;
    /** Dataset → metric name → its SQL aggregate (unused here; the shape is
     *  what the server sends and the KEYS are what the picker offers). */
    metrics: Record<string, Record<string, string>>;
    /** Dataset → dimension → the values a filter chip can select. */
    values: Record<string, Record<string, string[]>>;
    counts: { spans: number; llm: number; agent_runs: number };
    range: { min_day: string; max_day: string };
    /** Epoch ms, as a string or a number depending on the driver. */
    lastIngest: string | number;
    /** Set instead of the fields above when the store could not be read. */
    error?: string;
}

/** `/api/q`'s body: the rows plus the metric columns they carry. */
export interface QueryResult {
    rows: MetricRow[];
    metrics: string[];
    error?: string;
}

/** One row of `/api/issues` — per-issue spend, split by agent role. */
export interface IssueRow {
    issue: number;
    title: string | null;
    first_ts: number;
    family: string | null;
    impl_model: string | null;
    impl_min: number | null;
    impl_cost: number | null;
    rev_min: number | null;
    rev_cost: number | null;
    fixups: number | null;
    fix_min: number | null;
    fix_cost: number | null;
    other_min: number | null;
    other_cost: number | null;
    runs: number | null;
    latency_min: number | null;
    out_tok: number | null;
    cost: number | null;
    state: string | null;
}

/** `/api/issues`' fixup-rate headline, one entry per model tier. */
export interface IssueTierSummary {
    issues: number;
    withFixup: number;
}

export interface IssuesPayload {
    rows: IssueRow[];
    tiers?: Record<string, IssueTierSummary>;
}

/** One row of `/api/sessions`. `prs` arrives as a JSON STRING, not an array —
 *  the column is stored that way and the port does not reshape the wire. */
export interface SessionRow {
    session: string;
    title: string | null;
    cmd: string | null;
    t0: number;
    wall_min: number | null;
    impl_min: number | null;
    rev_min: number | null;
    fix_min: number | null;
    other_min: number | null;
    issues: number | null;
    prs: string | null;
    orch_cost: number | null;
    cost: number | null;
}

export interface SessionsPayload {
    rows: SessionRow[];
}

/** One row of `/api/families` — a (family, role) cell of the pivot. */
export interface FamilyRow {
    family: string;
    role: string;
    minutes: number;
    cost: number;
    out_tok: number;
    issues: number;
}

export interface FamiliesPayload {
    rows: FamilyRow[];
}

/** One row of `/api/runs` — a single subagent run under an issue or session. */
export interface RunRow {
    agent_id: string;
    description: string | null;
    role: string;
    model: string | null;
    min: number;
    msgs: number;
    avg_ctx_k: number;
    out_tok: number;
    cost: number;
}

export interface RunsPayload {
    rows: RunRow[];
}
