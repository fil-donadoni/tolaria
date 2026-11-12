/**
 * GitHub state of the issue behind each Bug Report row (issue #9013).
 *
 * The admin page shows whether a report's issue is still open, so handled and
 * new reports do not look alike. The state lives on the row (`issueState`,
 * `issueCloseReason`, `issueClosedAt`, `issueSyncedAt`) and is kept by a 15
 * minute sync: one GitHub REST read of `user-report` issues changed since the
 * last sync (first run: every one — the backfill). No webhook, no new secret:
 * the `GITHUB_TOKEN` already used for filing reads the public repo.
 *
 * Pure parts (`mapIssueState`, `fetchChangedIssues`, `runIssueStateSync`) take
 * their I/O as arguments so they are tested without stubbing globals.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
    internalAction,
    internalMutation,
    internalQuery,
} from "./_generated/server";

const REPO = "fil-donadoni/tolaria";
const PER_PAGE = 100;

export interface GithubIssueRef {
    number: number;
    state: string;
    state_reason?: string | null;
    closed_at?: string | null;
    /** Present on pull requests, which the issues endpoint also lists. */
    pull_request?: unknown;
}

export interface IssueStatePatch {
    issueNumber: number;
    issueState: "open" | "closed";
    issueCloseReason?: "completed" | "not_planned";
    issueClosedAt?: number;
}

/**
 * GitHub `open` / `closed` + `state_reason` → the row's state. A closed issue
 * with `not_planned` (or `duplicate`) reads as not planned; every other closed
 * issue — `completed`, or no reason on an old issue — reads as completed.
 */
export function mapIssueState(issue: GithubIssueRef): IssueStatePatch {
    if (issue.state !== "closed")
        return { issueNumber: issue.number, issueState: "open" };
    const closedAt = issue.closed_at ? Date.parse(issue.closed_at) : NaN;
    return {
        issueNumber: issue.number,
        issueState: "closed",
        issueCloseReason:
            issue.state_reason === "not_planned" ||
            issue.state_reason === "duplicate"
                ? "not_planned"
                : "completed",
        ...(Number.isNaN(closedAt) ? {} : { issueClosedAt: closedAt }),
    };
}

/** Labels whose issues have a `bugReports` row: a user report, and a
 *  system-filed Bot fault. A report an admin later retypes (drops
 *  `user-report`) leaves the sync and keeps its last known state. */
export const SYNCED_ISSUE_LABELS = ["user-report", "bot-fault"] as const;

/** Re-read window: an issue updated WHILE a read pages through the list can
 *  shift a neighbour past a page boundary; the next run starts this far back so
 *  it is fetched then. Re-applying a state is idempotent. */
export const SYNC_OVERLAP_MS = 60_000;

/** Every issue of one label changed since `since`, following pagination.
 *  Throws on any non-OK page, so a partial read is never mistaken for a full one. */
async function fetchLabelIssues(
    fetchImpl: typeof fetch,
    token: string,
    label: string,
    since: string | undefined
): Promise<GithubIssueRef[]> {
    const all: GithubIssueRef[] = [];
    for (let page = 1; ; page++) {
        const params = new URLSearchParams({
            labels: label,
            state: "all",
            per_page: String(PER_PAGE),
            page: String(page),
            sort: "updated",
            direction: "asc",
        });
        if (since) params.set("since", since);
        const res = await fetchImpl(
            `https://api.github.com/repos/${REPO}/issues?${params}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "application/vnd.github+json",
                    "User-Agent": "tolaria-bug-report",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            }
        );
        if (!res.ok)
            throw new Error(`GitHub issues read failed (${res.status})`);
        const batch = (await res.json()) as GithubIssueRef[];
        all.push(...batch.filter((i) => i.pull_request === undefined));
        if (batch.length < PER_PAGE) return all;
    }
}

/** Every synced-label issue changed since `since`, one read per label. */
export async function fetchChangedIssues(
    fetchImpl: typeof fetch,
    token: string,
    since: string | undefined
): Promise<GithubIssueRef[]> {
    const byNumber = new Map<number, GithubIssueRef>();
    for (const label of SYNCED_ISSUE_LABELS)
        for (const issue of await fetchLabelIssues(
            fetchImpl,
            token,
            label,
            since
        ))
            byNumber.set(issue.number, issue);
    return [...byNumber.values()];
}

export interface IssueStateSyncDeps {
    fetchImpl: typeof fetch;
    token: string | undefined;
    now: () => number;
    getCursor: () => Promise<string | undefined>;
    apply: (patches: IssueStatePatch[], syncedAt: number) => Promise<void>;
    setCursor: (since: string, syncedAt: number) => Promise<void>;
}

/** One sync run. The cursor advances to the run's START time (less `SYNC_OVERLAP_MS`) only after the
 *  whole read AND the write succeeded; any throw leaves it where it was, so
 *  the next run re-reads the same window. Returns the issues applied. */
export async function runIssueStateSync(
    deps: IssueStateSyncDeps
): Promise<number | "skipped"> {
    if (!deps.token) return "skipped";
    const startedAt = deps.now();
    const since = await deps.getCursor();
    const issues = await fetchChangedIssues(deps.fetchImpl, deps.token, since);
    await deps.apply(issues.map(mapIssueState), startedAt);
    await deps.setCursor(
        new Date(startedAt - SYNC_OVERLAP_MS).toISOString(),
        startedAt
    );
    return issues.length;
}

const patchValidator = v.object({
    issueNumber: v.number(),
    issueState: v.union(v.literal("open"), v.literal("closed")),
    issueCloseReason: v.optional(
        v.union(v.literal("completed"), v.literal("not_planned"))
    ),
    issueClosedAt: v.optional(v.number()),
});

/** Writes the mapped states onto their rows by issue number; an issue with no
 *  row is ignored. */
export const applyIssueStates = internalMutation({
    args: { patches: v.array(patchValidator), syncedAt: v.number() },
    returns: v.number(),
    handler: async (ctx, { patches, syncedAt }) => {
        let written = 0;
        for (const { issueNumber, ...state } of patches) {
            const rows = await ctx.db
                .query("bugReports")
                .withIndex("by_issueNumber", (q) =>
                    q.eq("issueNumber", issueNumber)
                )
                .collect();
            for (const row of rows) {
                await ctx.db.patch(row._id, {
                    ...state,
                    // A reopened issue drops its close fields.
                    issueCloseReason: state.issueCloseReason,
                    issueClosedAt: state.issueClosedAt,
                    issueSyncedAt: syncedAt,
                });
                written++;
            }
        }
        return written;
    },
});

export const getSyncCursor = internalQuery({
    args: {},
    returns: v.union(v.string(), v.null()),
    handler: async (ctx) => {
        const row = await ctx.db.query("bugReportSync").first();
        return row?.since ?? null;
    },
});

export const setSyncCursor = internalMutation({
    args: { since: v.string(), syncedAt: v.number() },
    returns: v.null(),
    handler: async (ctx, { since, syncedAt }) => {
        const row = await ctx.db.query("bugReportSync").first();
        if (row) await ctx.db.patch(row._id, { since, syncedAt });
        else await ctx.db.insert("bugReportSync", { since, syncedAt });
        return null;
    },
});

export const syncIssueStates = internalAction({
    args: {},
    returns: v.null(),
    handler: async (ctx) => {
        const result = await runIssueStateSync({
            fetchImpl: fetch,
            token: process.env.GITHUB_TOKEN,
            now: Date.now,
            getCursor: async () =>
                (await ctx.runQuery(
                    internal.bugReportIssueState.getSyncCursor,
                    {}
                )) ?? undefined,
            apply: async (patches, syncedAt) => {
                // Chunked: one mutation per 100 keeps each transaction small.
                for (let i = 0; i < patches.length; i += 100)
                    await ctx.runMutation(
                        internal.bugReportIssueState.applyIssueStates,
                        { patches: patches.slice(i, i + 100), syncedAt }
                    );
            },
            setCursor: async (since, syncedAt) => {
                await ctx.runMutation(
                    internal.bugReportIssueState.setSyncCursor,
                    { since, syncedAt }
                );
            },
        });
        if (result === "skipped")
            console.warn("bugReportIssueState: GITHUB_TOKEN unset, skipped");
        return null;
    },
});

/** What the admin page shows for a row. */
export type ReportGithubState =
    | "not_filed"
    | "open"
    | "closed_completed"
    | "closed_not_planned";

export const reportGithubStateValidator = v.union(
    v.literal("not_filed"),
    v.literal("open"),
    v.literal("closed_completed"),
    v.literal("closed_not_planned")
);

/** A row with no issue was never filed; a filed row the sync has not reached
 *  yet reads as open (every filing starts open). Pure. */
export function deriveGithubState(row: {
    issueNumber?: number;
    issueState?: "open" | "closed";
    issueCloseReason?: "completed" | "not_planned";
}): ReportGithubState {
    if (row.issueNumber === undefined) return "not_filed";
    if (row.issueState !== "closed") return "open";
    return row.issueCloseReason === "not_planned"
        ? "closed_not_planned"
        : "closed_completed";
}

/** The default list: everything except a closed issue — an unfiled report is
 *  unhandled and must not be hidden. */
export function isClosedReport(row: Parameters<typeof deriveGithubState>[0]) {
    return deriveGithubState(row).startsWith("closed");
}
