import type { NowPayload } from "../../../lib/nowPayload";

/**
 * THE GOLDEN PAYLOAD (PRD #3148 S2 AC: "every section renders with the same
 * numbers as the vanilla view for the same payload").
 *
 * One object, in the shape `/api/loop-status` plus the two live reads actually
 * return, with figures chosen to be individually recognisable in the rendered
 * output: 7 waiting, 3 claimed, 12 receipts, 41 merges is not a set of numbers
 * a renderer can produce by accident.
 *
 * `NOW_MS` is a FIXED clock, and every relative figure in the fixture is
 * expressed against it. The Now view composes against one stamped clock rather
 * than reading `Date.now()` at each render site, which is what makes "23h ago"
 * an assertable string instead of a race.
 */

/** 2026-09-07T12:00:00Z — arbitrary, fixed, and the origin of every age below. */
export const NOW_MS = Date.UTC(2026, 8, 7, 12, 0, 0);

const HOUR = 3_600_000;

export function goldenPayload(): NowPayload {
    return {
        verdict: {
            state: "NEEDS ATTENTION",
            sentence: "Two claims are orphaned and no driver is running.",
            remedy: "`bun run loop:doctor --release` to drop `in-progress`",
            remedyAction: "driver.resume",
            findings: [
                { code: "orphaned-claims", detail: "2 orphaned claims" },
            ],
        },
        driver: {
            armed: true,
            pid: 4242,
            pidAlive: false,
            stopFilePresent: false,
            recentPasses: [
                {
                    epoch: Math.floor((NOW_MS - 2 * HOUR) / 1000),
                    pass: 17,
                    claudeExit: 0,
                    pct: "28.03027192142857",
                    queueBefore: 221,
                    queueAfter: 218,
                    reason: "-",
                },
                {
                    epoch: Math.floor((NOW_MS - HOUR) / 1000),
                    pass: 18,
                    claudeExit: 1,
                    pct: "31.5",
                    queueBefore: 218,
                    queueAfter: 218,
                    reason: "claims-held",
                },
            ],
        },
        claims: [
            {
                issue: 3151,
                title: "port the Now view",
                stage: "PR open",
                verdict: { state: "live", reason: "open PR" },
                priority: "P1",
                ageHours: 3.5,
                dependents: 2,
            },
            {
                issue: 3152,
                title: "an orphaned claim",
                stage: "claimed",
                verdict: { state: "orphan", reason: "no branch after 6h" },
                priority: "P0",
                ageHours: 23.8,
                dependents: 0,
            },
            {
                issue: 3153,
                title: "too young to judge",
                stage: "worktree",
                verdict: { state: "suspect", reason: "no branch yet" },
                priority: null,
                ageHours: 0.5,
                dependents: null,
            },
        ],
        claimsError: null,
        queueDepth: { P0: 1, P1: 2, P2: 3, unprioritized: 1, total: 7 },
        queueDepthError: null,
        receiptsSummary: {
            total: 12,
            counts: [
                { role: "implement", outcome: "done", count: 8 },
                { role: "review", outcome: "done", count: 3 },
                { role: "missing", outcome: "missing", count: 1 },
            ],
            interesting: [
                {
                    role: "implement",
                    outcome: "failed",
                    issue: 3140,
                    pr: 3141,
                },
            ],
        },
        batch: "9f8e7d6c-5b4a-3210-9f8e-7d6c5b4a3210",
        batchStartedAt: Math.floor((NOW_MS - 3 * HOUR) / 1000),
        priorityWarning: null,
        receiptErrors: [],
        timelinePasses: [
            {
                epoch: Math.floor((NOW_MS - 2 * HOUR) / 1000),
                pass: 17,
                claudeExit: 0,
                pct: "28.0",
                queueBefore: 221,
                queueAfter: 218,
                reason: "-",
            },
            {
                epoch: Math.floor((NOW_MS - HOUR) / 1000),
                pass: 18,
                claudeExit: 1,
                pct: "31.5",
                queueBefore: 218,
                queueAfter: 218,
                reason: "claims-held",
            },
        ],
        recentMerges: [
            {
                number: 3160,
                title: "dashboard S1",
                mergedAt: new Date(NOW_MS - 5 * HOUR).toISOString(),
            },
            {
                number: 3159,
                title: "oracle compiler",
                mergedAt: new Date(NOW_MS - 6 * HOUR).toISOString(),
            },
        ],
        recentMergesError: null,
        recentMergesTruncated: false,
        dependentsError: null,
        activity: {
            windowHours: 24,
            asOf: NOW_MS,
            buckets: [
                {
                    hourStart: Math.floor((NOW_MS - HOUR) / HOUR) * HOUR,
                    inTok: 1000,
                    outTok: 54_321,
                    cacheRead: 900,
                    cacheWrite: 100,
                    cost: 12.5,
                    messages: 40,
                },
            ],
        },
        live: {
            asOf: NOW_MS,
            liveMinutes: 30,
            activeMinutes: 3,
            sessions: [
                {
                    session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    title: "porting the Now view",
                    lastPrompt: null,
                    cwd: null,
                    gitBranch: "feat/issue-3151",
                    lastWriteMs: NOW_MS - 120_000,
                    lastMessageMs: NOW_MS - 120_000,
                    outTok: 98_765,
                    inTok: 10,
                    cacheRead: 10,
                    cost: 1,
                    messages: 5,
                    subagents: 2,
                    topIssues: [{ issue: 3151, mentions: 9 }],
                    liveness: "active",
                },
                {
                    session: "11111111-2222-3333-4444-555555555555",
                    title: "another session",
                    lastPrompt: null,
                    cwd: null,
                    gitBranch: null,
                    lastWriteMs: NOW_MS - 15 * 60_000,
                    lastMessageMs: NOW_MS - 15 * 60_000,
                    outTok: 1234,
                    inTok: 1,
                    cacheRead: 1,
                    cost: 0,
                    messages: 1,
                    subagents: 0,
                    topIssues: [],
                    liveness: "live",
                },
            ],
            byIssue: {
                3151: [
                    {
                        session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                        title: "porting the Now view",
                        lastPrompt: null,
                        cwd: null,
                        gitBranch: "feat/issue-3151",
                        lastWriteMs: NOW_MS - 120_000,
                        lastMessageMs: NOW_MS - 120_000,
                        outTok: 98_765,
                        inTok: 10,
                        cacheRead: 10,
                        cost: 1,
                        messages: 5,
                        subagents: 2,
                        topIssues: [{ issue: 3151, mentions: 9 }],
                        liveness: "active",
                    },
                ],
            },
        },
    };
}

/** A tail page with one entry, enough for the drawer to render a heading and
 *  a body without the test caring what a transcript says. */
export const TAIL_PAGE = {
    session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    offset: 1024,
    lastWriteMs: NOW_MS - 1000,
    truncated: false,
    entries: [
        {
            kind: "assistant" as const,
            ts: NOW_MS - 1000,
            text: "the transcript says something",
        },
    ],
    summary: null,
};

/**
 * A `fetch` that answers the Now view's three reads from one payload. Returns
 * the call log so a test can assert what was asked for — the `issues=` query
 * the live read carries is derived from the claims, and getting that wrong is
 * silent (an empty session column, not an error).
 */
export function stubNowFetch(payload: NowPayload = goldenPayload()) {
    const calls: string[] = [];
    const { activity, live, ...loopStatus } = payload;
    const json = (body: unknown) =>
        Promise.resolve({
            ok: true,
            json: () => Promise.resolve(body),
        } as Response);
    const fetchStub = (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.startsWith("/api/activity")) return json(activity ?? {});
        if (url.startsWith("/api/live")) return json(live ?? {});
        if (url.startsWith("/api/tail")) {
            const session =
                new URLSearchParams(url.split("?")[1] ?? "").get("session") ??
                "";
            return json({ ...TAIL_PAGE, session });
        }
        return json(loopStatus);
    };
    return { calls, fetchStub };
}
