// A REST fallback for the handful of `gh issue list` / `gh pr list` reads
// `loop:status` makes.
//
// ── Why ──────────────────────────────────────────────────────────────────────
//
// `gh issue list` and `gh pr list` are GraphQL calls. GitHub meters GraphQL on
// its OWN 5000-point/hour pool, entirely separate from the REST core pool —
// and this repo's automation (the telemetry dashboard polling
// `/api/loop-status`, `loop-drain.sh`'s queue polls, `queue:plan`'s board
// reads) exhausts the GraphQL pool routinely while REST sits untouched.
// Measured 2026-09-07: `graphql 0/5000 remaining`, `core 5000/5000 remaining`.
//
// When that happens EVERY `gh`-backed section of `loop:status` reports
// UNAVAILABLE at once, and the screen — correctly, per #2519 round 3 finding 5
// — refuses to say whether anything is claimed or how deep the queue is. That
// is the right failure, but it is an avoidable one: every read the screen
// makes has an exact REST equivalent, and REST still had its full quota.
//
// So: GraphQL stays the primary path (unchanged, proven), and a rate-limited
// failure — and ONLY a rate-limited failure — is retried over REST.
//
// ── Why a runner decorator, not five rewritten call sites ────────────────────
//
// `fetchClaimedIssues`, `fetchOpenPrBranches`, `fetchUnclaimedReadyQueue`,
// `fetchOpenIssueBodies` and `fetchRecentMergedPrs` all already take a
// `runner` seam for testing. Wrapping THAT seam puts the fallback in one
// place: the five fetchers keep parsing the exact `--json` shape they always
// did, and neither they nor their tests learn that REST exists. The
// translation argv → REST → the same `--json` shape is a pure function
// (`planRestFallback`), which is the part worth testing.
//
// ── Fail-closed on anything unrecognised ─────────────────────────────────────
//
// `planRestFallback` returns `null` for any query whose shape it does not
// recognise EXACTLY, and the decorator then rethrows the original error. A
// half-understood `--search` string translated into an approximate REST query
// would answer a DIFFERENT question and render as if it were the real one —
// the same class of bug as the empty-queue-on-rate-limit this file exists to
// mitigate, just harder to see. An unrecognised read degrades to UNAVAILABLE,
// exactly as it does today.

import type { ShRunner } from "../loop-doctor";

/** One REST row, as `gh api` hands it back. Deliberately loose — every field
 *  this module reads is picked out by a `project` function below, which is
 *  where the REST→GraphQL field mapping is written down. */
type RestRow = Record<string, unknown>;

/** A recognised query, translated. `path` + `query` describe the REST
 *  endpoint (WITHOUT paging parameters — `runRestPlan` owns those), `limit`
 *  mirrors the `--limit` the caller asked for, and `project` maps REST rows
 *  back into the `--json` shape the caller is about to parse. */
export interface RestPlan {
    path: string;
    query: Record<string, string>;
    limit: number;
    project: (rows: RestRow[]) => unknown[];
    /** Short label naming the translated read, for error messages. */
    what: string;
}

/** GitHub's `/issues` endpoints return pull requests as well as issues — a
 *  PR row is exactly an issue row plus a `pull_request` key. `gh issue list`
 *  filters them out server-side; over REST that filter is ours. */
function isPullRequestRow(row: RestRow): boolean {
    return row.pull_request !== undefined;
}

function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
    return typeof v === "number" ? v : Number.NaN;
}

/** Value of `--flag value`, or `undefined` when the flag is absent. */
function flagValue(args: string[], flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

/** `--json a,b,c` as a Set, for exact-shape matching. */
function jsonFields(args: string[]): Set<string> {
    return new Set(
        (flagValue(args, "--json") ?? "").split(",").filter(Boolean)
    );
}

function sameFields(args: string[], expected: string[]): boolean {
    const got = jsonFields(args);
    return (
        got.size === expected.length &&
        expected.every((field) => got.has(field))
    );
}

function limitOf(args: string[], fallback: number): number {
    const raw = flagValue(args, "--limit");
    const n = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Parse a `--search` string into the qualifiers we can honour over REST.
 * Returns `null` the moment it meets a token it does not understand — see the
 * fail-closed note in the module header. `sort:` is returned rather than
 * rejected so the caller can decide whether REST can express that ordering.
 */
function parseSearch(
    search: string
): { labels: string[]; sort: string | null } | null {
    const result: { labels: string[]; sort: string | null } = {
        labels: [],
        sort: null,
    };
    for (const token of search.trim().split(/\s+/).filter(Boolean)) {
        // `is:open` / `is:issue` / `is:pr` are already implied by the endpoint
        // and the `state=` parameter the caller pairs them with, so they are
        // understood-and-ignored rather than unrecognised.
        if (token === "is:open" || token === "is:issue" || token === "is:pr") {
            continue;
        }
        if (token.startsWith("label:")) {
            result.labels.push(token.slice("label:".length));
            continue;
        }
        if (token.startsWith("sort:")) {
            result.sort = token.slice("sort:".length);
            continue;
        }
        // Anything else — a `-label:` exclusion, a date range, free text —
        // has no faithful REST equivalent here.
        return null;
    }
    return result;
}

/**
 * Translate one `gh issue list` / `gh pr list` argv into a REST plan, or
 * `null` when the query is not one of the five `loop:status` makes.
 *
 * Exported for its own test: this function IS the risk in this module, since
 * a wrong mapping produces a plausible-looking answer to the wrong question.
 */
export function planRestFallback(
    args: string[],
    repo: string
): RestPlan | null {
    const [subject, verb] = args;
    if (verb !== "list") return null;

    if (subject === "issue") return planIssueList(args, repo);
    if (subject === "pr") return planPrList(args, repo);
    return null;
}

function planIssueList(args: string[], repo: string): RestPlan | null {
    const state = flagValue(args, "--state");
    const search = flagValue(args, "--search");

    // Labels come either from `--label` or from `label:` qualifiers inside
    // `--search`; REST takes both as one comma-separated `labels=` parameter.
    const labels: string[] = [];
    const labelFlag = flagValue(args, "--label");
    if (labelFlag !== undefined) labels.push(labelFlag);

    let searchState: string | null = null;
    if (search !== undefined) {
        const parsed = parseSearch(search);
        // REST's `/issues` has no ordering parameter matching a search
        // `sort:`, so a search that asks for one is not translatable here.
        if (parsed === null || parsed.sort !== null) return null;
        labels.push(...parsed.labels);
        if (/\bis:open\b/.test(search)) searchState = "open";
    }

    // Every issue read `loop:status` makes is an OPEN-issue read. Refusing
    // anything else keeps the `state` mapping honest rather than guessing.
    const effectiveState = state ?? searchState;
    if (effectiveState !== "open") return null;

    const query: Record<string, string> = { state: "open" };
    if (labels.length > 0) query.labels = labels.join(",");

    // `number,title,updatedAt` — the claimed-issue read (`fetchClaimedIssues`).
    if (sameFields(args, ["number", "title", "updatedAt"])) {
        return {
            path: `repos/${repo}/issues`,
            query,
            limit: limitOf(args, 200),
            what: "issue list (number,title,updatedAt)",
            project: (rows) =>
                rows
                    .filter((r) => !isPullRequestRow(r))
                    .map((r) => ({
                        number: num(r.number),
                        title: str(r.title),
                        // GraphQL `updatedAt` is REST `updated_at`.
                        updatedAt: str(r.updated_at),
                    })),
        };
    }

    // `number,labels` — the ready-for-agent queue read
    // (`fetchUnclaimedReadyQueue`, which filters `in-progress` client-side).
    if (sameFields(args, ["number", "labels"])) {
        return {
            path: `repos/${repo}/issues`,
            query,
            limit: limitOf(args, 300),
            what: "issue list (number,labels)",
            project: (rows) =>
                rows
                    .filter((r) => !isPullRequestRow(r))
                    .map((r) => ({
                        number: num(r.number),
                        labels: (Array.isArray(r.labels) ? r.labels : []).map(
                            (l) => ({ name: str((l as RestRow)?.name) })
                        ),
                    })),
        };
    }

    // `number,body` — the open-issue-bodies read (`fetchOpenIssueBodies`,
    // whose `countDependents` greps each body for a `## Blocked by` entry).
    if (sameFields(args, ["number", "body"])) {
        return {
            path: `repos/${repo}/issues`,
            query,
            limit: limitOf(args, 1000),
            what: "issue list (number,body)",
            project: (rows) =>
                rows
                    .filter((r) => !isPullRequestRow(r))
                    .map((r) => ({
                        number: num(r.number),
                        // REST sends `null` for an empty body; GraphQL sends "".
                        body: str(r.body),
                    })),
        };
    }

    return null;
}

function planPrList(args: string[], repo: string): RestPlan | null {
    const state = flagValue(args, "--state");
    const search = flagValue(args, "--search");

    // `--state open --json headRefName` — the open-PR read
    // (`fetchOpenPrBranches`).
    if (
        state === "open" &&
        search === undefined &&
        sameFields(args, ["headRefName"])
    ) {
        return {
            path: `repos/${repo}/pulls`,
            query: { state: "open" },
            limit: limitOf(args, 300),
            what: "pr list (headRefName)",
            project: (rows) =>
                rows.map((r) => ({
                    headRefName: str((r.head as RestRow)?.ref),
                })),
        };
    }

    // `--state merged --search sort:updated-desc` — the recently-merged read
    // (`fetchRecentMergedPrs`). REST has no `merged` state, so this asks for
    // `closed` newest-updated-first and lets the caller's existing
    // `mergedAt !== null` filter do exactly what it already does to the
    // GraphQL page. That filter is why the substitution is safe: an
    // unmerged closed PR carries `merged_at: null` and is dropped there.
    if (
        state === "merged" &&
        sameFields(args, ["number", "title", "mergedAt", "updatedAt"])
    ) {
        const parsed = search === undefined ? null : parseSearch(search);
        if (search !== undefined && parsed?.sort !== "updated-desc")
            return null;
        return {
            path: `repos/${repo}/pulls`,
            query: {
                state: "closed",
                sort: "updated",
                direction: "desc",
            },
            limit: limitOf(args, 200),
            what: "pr list (merged, sort:updated-desc)",
            project: (rows) =>
                rows.map((r) => ({
                    number: num(r.number),
                    title: str(r.title),
                    // `merged_at` stays NULL for a closed-unmerged PR — the
                    // caller's own filter depends on that, so it is passed
                    // through as null rather than coerced to "".
                    mergedAt:
                        typeof r.merged_at === "string" ? r.merged_at : null,
                    updatedAt: str(r.updated_at),
                })),
        };
    }

    return null;
}

/**
 * Is this failure the one worth retrying over REST?
 *
 * Only a rate-limit refusal. A missing scope, a network failure or a bad
 * query would fail identically over REST, and retrying them would double the
 * latency of every genuine outage while hiding its real cause behind a
 * second, differently-worded error.
 */
export function isRateLimitFailure(message: string): boolean {
    return /rate limit/i.test(message);
}

/** Paging is ours over REST: `gh api --paginate` fetches EVERY page, which on
 *  `pulls?state=closed` means thousands of rows for a read that asked for 200.
 *  This walks pages until the caller's `--limit` is met or the API runs out. */
const REST_PAGE_SIZE = 100;

function runRestPlan(
    plan: RestPlan,
    runner: (args: string[]) => string
): unknown[] {
    const rows: RestRow[] = [];
    const pages = Math.ceil(plan.limit / REST_PAGE_SIZE);
    for (let page = 1; page <= pages; page++) {
        const perPage = Math.min(REST_PAGE_SIZE, plan.limit - rows.length);
        const query = new URLSearchParams({
            ...plan.query,
            per_page: String(perPage),
            page: String(page),
        });
        const parsed: unknown = JSON.parse(
            runner(["api", `${plan.path}?${query}`]) || "[]"
        );
        const batch = Array.isArray(parsed) ? (parsed as RestRow[]) : [];
        rows.push(...batch);
        // A short page is the last page.
        if (batch.length < perPage) break;
    }
    // `project` filters PRs out of issue reads, so the cap is applied to the
    // PROJECTED rows — otherwise a page full of PRs would eat the budget and
    // return fewer issues than the caller asked for.
    return plan.project(rows).slice(0, plan.limit);
}

/**
 * Wrap an args-only `gh` runner so a rate-limited `gh issue list` / `gh pr
 * list` is retried over REST. Anything else — an unrecognised query, a
 * non-rate-limit failure, or a REST retry that fails too — throws, carrying
 * BOTH errors so the screen still says UNAVAILABLE and names why.
 */
export function withRestFallback(
    base: (args: string[]) => string,
    repo: string
): (args: string[]) => string {
    return (args) => {
        try {
            return base(args);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (!isRateLimitFailure(message)) throw err;
            const plan = planRestFallback(args, repo);
            if (plan === null) throw err;
            try {
                return JSON.stringify(runRestPlan(plan, base));
            } catch (restErr) {
                const restMessage =
                    restErr instanceof Error
                        ? restErr.message
                        : String(restErr);
                throw new Error(
                    `${message} — REST fallback (${plan.what}) also failed: ${restMessage}`
                );
            }
        }
    };
}

/** The `(cmd, args)` counterpart, for the runner `fetchClaimedIssues` /
 *  `fetchOpenPrBranches` / `fetchBranchNames` share. Non-`gh` commands (the
 *  `git` branch reads) pass straight through untouched — they have no
 *  GitHub quota to run out of. */
export function withRestFallbackSh(base: ShRunner, repo: string): ShRunner {
    const wrapped = withRestFallback((args) => base("gh", args), repo);
    return (cmd, args) => (cmd === "gh" ? wrapped(args) : base(cmd, args));
}
