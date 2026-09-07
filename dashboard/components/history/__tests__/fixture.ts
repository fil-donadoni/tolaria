import type {
    FamiliesPayload,
    HistoryMeta,
    IssuesPayload,
    QueryResult,
    RunsPayload,
    SessionsPayload,
} from "../../../lib/historyPayload";

/**
 * A GOLDEN telemetry store for the History view (PRD #3148 S3).
 *
 * The AC is "every History panel renders against a fixture database with the
 * same figures as today", so the tests assert the STRINGS an operator reads —
 * `2h 14m`, `$1,024`, `12'`, `43% of total` — not the raw fields. A port that
 * changed a rounding rule, a floor or a plural would pass a field-level check
 * and fail a person.
 *
 * The shape mirrors what `scripts/telemetry-serve.ts` actually returns,
 * including the awkward parts that exist on the wire: `prs` as a JSON STRING,
 * `lastIngest` as a stringified epoch, a `null` family, a metric whose name
 * begins `avg_` and therefore may not be stacked.
 */

export const META: HistoryMeta = {
    dimensions: {
        agent_runs: ["day", "agent_id", "role", "model"],
        llm: ["day", "session", "model"],
    },
    metrics: {
        agent_runs: {
            runs: "count(*)",
            total_seconds: "sum(sec)",
            cost_usd: "sum(cost)",
            out_tokens: "sum(out)",
            avg_ctx_k: "avg(ctx)",
        },
        llm: { messages: "count(*)", cost_usd: "sum(cost)" },
    },
    values: {
        agent_runs: {
            role: ["implement", "review", "fixup"],
            model: ["opus", "sonnet"],
            agent_id: [],
        },
        llm: { model: ["opus", "sonnet"], session: [] },
    },
    counts: { spans: 12_345, llm: 6_789, agent_runs: 432 },
    range: { min_day: "2026-08-01", max_day: "2026-08-03" },
    lastIngest: "1757000000000",
};

/** `groupBy: ["day", split]` — three days, two roles, one gap on day 2. */
export const PER_DAY: QueryResult = {
    metrics: ["runs", "total_seconds", "cost_usd", "out_tokens", "avg_ctx_k"],
    rows: [
        { day: "2026-08-01", role: "implement", total_seconds: 3600, runs: 4 },
        { day: "2026-08-01", role: "review", total_seconds: 1200, runs: 2 },
        { day: "2026-08-02", role: "implement", total_seconds: 7200, runs: 6 },
        { day: "2026-08-03", role: "implement", total_seconds: 1800, runs: 3 },
        { day: "2026-08-03", role: "review", total_seconds: 600, runs: 1 },
    ],
};

/** `groupBy: [split]` — the ranking card and the metric table read these. */
export const BY_SPLIT: QueryResult = {
    metrics: ["runs", "total_seconds", "cost_usd", "out_tokens", "avg_ctx_k"],
    rows: [
        {
            role: "implement",
            runs: 13,
            total_seconds: 12_600,
            cost_usd: 42.5,
            out_tokens: 120_000,
            avg_ctx_k: 88,
        },
        {
            role: "review",
            runs: 3,
            total_seconds: 1800,
            cost_usd: 6.25,
            out_tokens: 20_000,
            avg_ctx_k: 44,
        },
    ],
};

/** `groupBy: []` — the one totals row behind the tiles. */
export const TOTALS: QueryResult = {
    metrics: ["runs", "total_seconds", "cost_usd", "out_tokens", "avg_ctx_k"],
    rows: [
        {
            runs: 16,
            total_seconds: 14_400,
            cost_usd: 48.75,
            out_tokens: 140_000,
            avg_ctx_k: 80,
        },
    ],
};

export const ISSUES: IssuesPayload = {
    tiers: {
        "claude-opus-5": { issues: 4, withFixup: 1 },
        "claude-sonnet-5": { issues: 2, withFixup: 0 },
    },
    rows: [
        {
            issue: 3152,
            title: "dashboard S3: port the History view to React + shadcn",
            first_ts: 1_756_000_000,
            family: "dashboard",
            impl_model: "claude-opus-5-20260101",
            impl_min: 42.4,
            impl_cost: 12.5,
            rev_min: 8.6,
            rev_cost: 3.25,
            fixups: 1,
            fix_min: 4,
            fix_cost: 1.5,
            other_min: 0,
            other_cost: 0,
            runs: 7,
            latency_min: 61,
            out_tok: 84_000,
            cost: 17.25,
            state: "closed",
        },
        {
            issue: 3153,
            title: "dashboard S4: retire scripts/dashboard",
            first_ts: 1_756_100_000,
            family: null,
            impl_model: "claude-sonnet-5-20260101",
            impl_min: 12,
            impl_cost: 2,
            rev_min: 0,
            rev_cost: 0,
            fixups: 0,
            fix_min: 0,
            fix_cost: 0,
            other_min: 3,
            other_cost: 0.5,
            runs: 2,
            latency_min: 15,
            out_tok: 9_000,
            cost: 2.5,
            state: "open",
        },
    ],
};

export const SESSIONS: SessionsPayload = {
    rows: [
        {
            session: "0aa11bb2-3333-4444-5555-666677778888",
            title: "port the History view",
            cmd: "/next-issue 3152",
            t0: 1_756_000_000,
            wall_min: 134,
            impl_min: 96,
            rev_min: 12,
            fix_min: 0,
            other_min: 4,
            issues: 1,
            prs: '["#3170","#3171"]',
            orch_cost: 3.5,
            cost: 21.75,
        },
        {
            session: "9cc33dd4-5555-6666-7777-888899990000",
            title: null,
            cmd: "/loop 5m",
            t0: 1_755_900_000,
            wall_min: 20,
            impl_min: 0,
            rev_min: 0,
            fix_min: 0,
            other_min: 20,
            issues: 0,
            prs: null,
            orch_cost: 0.75,
            cost: 0.75,
        },
        // The PR-count discriminator: `["#9"]` sorts BEFORE `["#3170",…]`
        // lexically and AFTER it by count, so a `prs` sort that compared the
        // raw JSON string instead of the array's length would order these two
        // the other way round.
        {
            session: "5ee55ff6-7777-8888-9999-aaaabbbbcccc",
            title: "one PR",
            cmd: "/next-issue 3149",
            t0: 1_755_800_000,
            wall_min: 45,
            impl_min: 30,
            rev_min: 5,
            fix_min: 0,
            other_min: 2,
            issues: 1,
            prs: '["#9"]',
            orch_cost: 1,
            cost: 4.5,
        },
    ],
};

export const FAMILIES: FamiliesPayload = {
    rows: [
        {
            family: "dashboard",
            role: "implement",
            minutes: 42.4,
            cost: 12.5,
            out_tok: 60_000,
            issues: 4,
        },
        {
            family: "dashboard",
            role: "review",
            minutes: 8.6,
            cost: 3.25,
            out_tok: 8_000,
            issues: 4,
        },
        // A role outside the four fixed columns — it must fold into `support`
        // rather than disappear from a table whose columns are fixed.
        {
            family: "dashboard",
            role: "verify",
            minutes: 2,
            cost: 0.5,
            out_tok: 900,
            issues: 4,
        },
        {
            family: "engine",
            role: "implement",
            minutes: 10,
            cost: 1.25,
            out_tok: 4_000,
            issues: 2,
        },
    ],
};

export const RUNS: RunsPayload = {
    rows: [
        {
            agent_id: "agent-1",
            description: "review PR #3170",
            role: "review",
            model: "claude-opus-5-20260101",
            min: 9,
            msgs: 41,
            avg_ctx_k: 88,
            out_tok: 12_400,
            cost: 3.25,
        },
    ],
};

export interface StubOptions {
    /** Fail `/api/meta` — the "no telemetry store" case (#2519). */
    metaError?: string;
    /** Fail the three narrative routes, leaving the charts drawn. */
    narrativeError?: string;
    /** Fail the aggregate route, leaving the narrative cards drawn. */
    queryError?: string;
}

/**
 * A `fetch` over the fixture. It branches on the REQUEST — the aggregate route
 * answers a different payload per `groupBy`, exactly as the server does — so a
 * card that asked for the wrong grouping gets the wrong rows rather than a
 * silently shared array.
 */
export function stubHistoryFetch(options: StubOptions = {}) {
    const calls: string[] = [];
    const json = (body: unknown, ok = true) =>
        Promise.resolve({
            ok,
            json: () => Promise.resolve(body),
        } as Response);

    const fetchStub = async (
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith("/api/meta"))
            return json(
                options.metaError ? { error: options.metaError } : META
            );
        if (url.startsWith("/api/q")) {
            if (options.queryError) return json({ error: options.queryError });
            const body = JSON.parse(String(init?.body ?? "{}")) as {
                groupBy?: string[];
            };
            const groupBy = body.groupBy ?? [];
            if (groupBy.length === 2) return json(PER_DAY);
            if (groupBy.length === 1) return json(BY_SPLIT);
            return json(TOTALS);
        }
        if (
            options.narrativeError &&
            /^\/api\/(issues|sessions|families)/.test(url)
        )
            return json({ error: options.narrativeError });
        if (url.startsWith("/api/issues")) return json(ISSUES);
        if (url.startsWith("/api/sessions")) return json(SESSIONS);
        if (url.startsWith("/api/families")) return json(FAMILIES);
        if (url.startsWith("/api/runs")) return json(RUNS);
        throw new Error(`unexpected fetch: ${url}`);
    };

    return { fetchStub, calls };
}
