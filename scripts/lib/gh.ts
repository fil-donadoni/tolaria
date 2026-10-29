// The one way a script in this repo shells out to `gh`.
//
// It exists to hold a single non-obvious rule that was previously duplicated in
// two wrappers — and a rule that lives in two places is a rule that drifts, with
// the stale copy reading as authoritative.
//
// ── Why the token is stripped ────────────────────────────────────────────────
//
// `.env.local` carries `GITHUB_TOKEN`: the narrow, fine-grained PAT that
// `convex/bugReports.ts` uses SERVER-SIDE to file issues on behalf of the app's
// bug-report feature. **bun auto-loads `.env.local` into `process.env` for every
// script it runs**, and `gh` prefers `GITHUB_TOKEN` over its keyring login. Net
// effect: every `gh` call from a `bun run` script authenticated as the
// bug-report integration rather than as the developer.
//
// The symptom is a permission error on an operation your INTERACTIVE `gh` does
// fine — e.g. `bun run queue:plan` failing with
// `GraphQL: Resource not accessible by personal access token (user.projectV2)`
// while a bare `gh project item-list` succeeds. That divergence is very hard to
// read as an auth problem, because both are "the same `gh`".
//
// So `GITHUB_TOKEN` is removed from the child's environment and `gh` falls back
// to `gh auth login`. **`GH_TOKEN` is deliberately left intact**: it is gh's own
// dedicated variable and the documented way to hand it a token in CI, so it
// remains the explicit override.
//
// Do NOT "fix" a permission error here by widening the app PAT. That credential
// ships to a server-side Convex action; the project board and the issue queue
// are none of its business.

import { execFileSync } from "child_process";

/**
 * The environment for anything in this repo that shells out to `gh` — or to
 * `git`/a spawned child that might itself invoke `gh` (land's locked
 * `gate.ts heavy` command is exactly that case: `gh pr merge` runs deep
 * inside a `spawnSync`, not via this module's own `gh()`). GITHUB_TOKEN
 * stripped, GH_TOKEN left alone — see the module comment above for why.
 *
 * Takes the base env as a parameter (default `process.env`) purely so a test
 * can assert on the transform without mutating real process state.
 */
export function netEnv(
    base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env = { ...base };
    delete env.GITHUB_TOKEN;
    return env;
}

// ── Why a read is retried on a 5xx (issue #5540) ─────────────────────────────
//
// One `HTTP 504: 504 Gateway Timeout (https://api.github.com/graphql)` on the
// `ready-for-agent` read stopped a whole AFK run at its pre-flight —
// fatal by design (issue #3088), so the fix belongs here, below it. A READ
// that met a gateway error is replayed after a short backoff; anything else
// throws on the first attempt. A WRITE is never replayed: a 504 on a write
// may have landed, and replaying `issue create` files a duplicate.

/** Waits between attempts: three retries, 17 s at most per call. */
export const GH_RETRY_BACKOFF_MS = [2_000, 5_000, 10_000] as const;

const READ_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
    issue: new Set(["list", "view", "status"]),
    pr: new Set(["list", "view", "status", "diff", "checks"]),
    project: new Set(["list", "view", "item-list", "field-list"]),
    repo: new Set(["view", "list"]),
    label: new Set(["list"]),
    run: new Set(["list", "view"]),
    release: new Set(["list", "view"]),
};

/** Whether `gh <args>` only READS — safe to replay after a failure whose
 *  effect is unknown. Unknown shapes are writes: fail closed. */
export function isReadOnlyGh(args: readonly string[]): boolean {
    const [command, sub] = args;
    if (command === "search") return true; // `gh search …` has no write verb
    if (command === "api") return isReadOnlyApi(args);
    return sub !== undefined && READ_SUBCOMMANDS[command]?.has(sub) === true;
}

/** A field flag in any spelling gh accepts (`-f k=v`, `-fk=v`,
 *  `--field=k=v`, …) → its value, read off `args[i]` or `args[i + 1]`. */
const FIELD_FLAG = /^(-f|-F|--field|--raw-field)(=|$)|^-[fF](?=.)/;

function isReadOnlyApi(args: readonly string[]): boolean {
    let method: string | undefined;
    const fields: string[] = [];
    let input = false;
    for (let i = 1; i < args.length; i++) {
        const a = args[i];
        if (a === "-X" || a === "--method") method = args[++i] ?? "";
        else if (/^--method=/.test(a)) method = a.slice(9);
        else if (/^-X./.test(a)) method = a.slice(2).replace(/^=/, "");
        else if (a === "--input" || a.startsWith("--input=")) input = true;
        else {
            const m = FIELD_FLAG.exec(a);
            if (!m) continue;
            const inline = a.slice(m[0].length);
            fields.push(inline !== "" ? inline : (args[++i] ?? ""));
        }
    }
    // `gh api graphql` POSTs its fields; the operation, not the verb, says
    // whether it writes — so a query this cannot read (a file, stdin, an
    // `--input` body) or that names `mutation` anywhere is a write.
    if (args.includes("graphql")) {
        if (input) return false;
        const query = fields.find((f) => f.startsWith("query="));
        if (query === undefined || /^query=[@-]/.test(query)) return false;
        return !/\bmutation\b/.test(query);
    }
    if (method !== undefined) return method.toUpperCase() === "GET" && !input;
    return fields.length === 0 && !input; // fields without -X make gh POST
}

// ── Why every call has a deadline (issue #5933) ──────────────────────────────
//
// `execFileSync` without `timeout` waits forever. On 2026-10-18 one
// `gaps:sync` run inside `housekeeping` took 47 minutes for work a shadow run
// does in about 5, and the job's own `timeout-minutes` killed it between the
// allowlist commit and its push — the stranded commit re-filed a whole wave
// of Grammar Gaps (issue #5871). A hung call must become a FAILURE the caller
// already handles, never a stall only the job timeout ends. A read gets
// 60 s (the slowest measured, a 2000-row `issue list`, takes ~6 s) and is
// replayed like a 5xx; a write gets 120 s and, like any failed write, is
// never replayed — it may have landed.

/** A read's deadline: ten times the slowest measured read. */
export const GH_READ_TIMEOUT_MS = 60_000;
/** A write's deadline: never replayed, so it is given more room. */
export const GH_WRITE_TIMEOUT_MS = 120_000;

/** The deadline `gh()` gives `gh <args>`. */
export function ghTimeoutMs(args: readonly string[]): number {
    return isReadOnlyGh(args) ? GH_READ_TIMEOUT_MS : GH_WRITE_TIMEOUT_MS;
}

/** Whether a failed child call was killed by its deadline — what
 *  `execFileSync` throws when `timeout` expires. */
export function isTimeoutError(err: unknown): boolean {
    return (err as { code?: unknown })?.code === "ETIMEDOUT";
}

/** Whether a failed `gh` call met a gateway-side error worth one more try —
 *  or its deadline, which reads the same: the far side did not answer.
 *  Reads `stderr` — `message` echoes the argv, whose own text (a search
 *  string, a query) could say "Bad Gateway". */
export function isTransientGhError(err: unknown): boolean {
    if (isTimeoutError(err)) return true;
    const e = err as { message?: unknown; stderr?: unknown };
    const stderr = String(e?.stderr ?? "");
    const text = stderr !== "" ? stderr : String(e?.message ?? "");
    return /HTTP 50[234]\b|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(
        text
    );
}

function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Retry state for one process. `outage` trips once a call spends its whole
 *  backoff on transient errors: GitHub is down, not flaking, and a per-item
 *  loop (`gaps:sync`, a marker sweep) must fail fast again rather than pay
 *  the backoff once per item. */
export interface GhRetryState {
    outage: boolean;
}
const processRetryState: GhRetryState = { outage: false };

/** `run()`, replayed per `backoff` while it fails transiently AND `args` is a
 *  read AND no earlier call tripped `state.outage`; the last error is
 *  rethrown unchanged. */
export function withGhRetry(
    args: readonly string[],
    run: () => string,
    sleep: (ms: number) => void = sleepSync,
    backoff: readonly number[] = GH_RETRY_BACKOFF_MS,
    state: GhRetryState = processRetryState
): string {
    for (let attempt = 0; ; attempt++) {
        try {
            const out = run();
            state.outage = false;
            return out;
        } catch (err) {
            if (state.outage || !isTransientGhError(err) || !isReadOnlyGh(args))
                throw err;
            if (attempt >= backoff.length) {
                state.outage = true;
                throw err;
            }
            const e = err as { message?: unknown; stderr?: unknown };
            const first = isTimeoutError(err)
                ? "no answer before the deadline"
                : `${String(e?.stderr ?? "")}\n${String(e?.message ?? err)}`
                      .split("\n")
                      .find((l) => /HTTP 50|Gateway|Unavailable/i.test(l));
            console.error(
                `gh: transient error on \`gh ${args.slice(0, 2).join(" ")}\` (${first?.trim() ?? "5xx"}) — retry ${attempt + 1}/${backoff.length} in ${backoff[attempt] / 1000}s`
            );
            sleep(backoff[attempt]);
        }
    }
}

/** One `gh` process, killed at `timeoutMs` — the single spawn `gh()` replays.
 *  The deadline is a parameter so a test can prove the kill in milliseconds. */
export function runGh(args: readonly string[], timeoutMs: number): string {
    return execFileSync("gh", args, {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
        env: netEnv(),
        timeout: timeoutMs,
        killSignal: "SIGKILL",
    });
}

/** Run `gh` under the DEVELOPER's credentials and return stdout. Throws on a
 *  non-zero exit or a missed deadline, like `execFileSync` — after replaying
 *  a read that met a transient 5xx or its deadline (see above). */
export function gh(args: string[]): string {
    return withGhRetry(args, () => runGh(args, ghTimeoutMs(args)));
}

/**
 * Set `child`'s native parent to `parent`, reading the edge back before
 * trusting it. `gh issue edit --parent` is unreliable under rapid fire
 * (issue-tracker doc): it can exit non-zero on success or no-op silently.
 * Retries 3 times, reading `parent.number` back after each attempt — the
 * read-back is the real check either way. Returns whether the edge was
 * confirmed; the caller decides how to report a failure (`gaps:sync` logs
 * and continues, `prd:copy` treats it as fatal).
 *
 * Shared so this retry is written once — `gaps:sync` and `prd:copy` both
 * mutate the native parent edge and neither re-implements it.
 */
export function setIssueParent(
    child: number,
    parent: number,
    ghClient: (args: string[]) => string = gh
): boolean {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            ghClient([
                "issue",
                "edit",
                String(child),
                "--parent",
                String(parent),
            ]);
        } catch {
            // Read-back below is the real check either way.
        }
        const out = ghClient([
            "issue",
            "view",
            String(child),
            "--json",
            "parent",
        ]);
        const got = (JSON.parse(out) as { parent?: { number?: number } }).parent
            ?.number;
        if (got === parent) return true;
    }
    return false;
}

/** How many sub-issues `parent` holds right now, straight off the REST
 *  summary GitHub already computes — never a client-side count of a
 *  `subIssues` listing, which pages. Fails loud on a missing/non-numeric
 *  field: reading it as 0 would let a caller's cap check pass silently. */
export function subIssueCount(
    parent: number,
    ghClient: (args: string[]) => string = gh
): number {
    const out = ghClient([
        "api",
        `repos/{owner}/{repo}/issues/${parent}`,
        "--jq",
        ".sub_issues_summary.total",
    ]);
    const total = Number(out.trim());
    if (out.trim() === "" || !Number.isInteger(total)) {
        throw new Error(
            `could not read issue #${parent}'s sub-issue count (got ${JSON.stringify(out.trim())})`
        );
    }
    return total;
}

/**
 * The NATIVE blocked-by edges of an issue — the dependency graph the board and
 * the "blocked" icon read, which is a different store from the `## Blocked by`
 * prose the planner parses out of the body (issue #3794).
 *
 * Paginated, and that is not a detail: `gh api` pages at 30, so past that a
 * freshly written edge falls off page one and a read-back reads as "the write
 * failed". `gaps:sync` learned that the hard way and this is its reader,
 * lifted here when the queue lint became the second consumer.
 *
 * Returns the numbers as GitHub reports them — unsorted, undeduplicated,
 * self-refs included. Every caller has its own opinion about those; the reader
 * has none.
 */
export function issueBlockedBy(
    issue: number,
    ghClient: (args: string[]) => string = gh
): number[] {
    // One number per line, every page: `--slurp` is refused beside `--jq`, and
    // the concatenated per-page output of a scalar filter is the shape `gh`
    // does give across pages.
    return ghClient([
        "api",
        "--paginate",
        `repos/{owner}/{repo}/issues/${issue}/dependencies/blocked_by`,
        "--jq",
        ".[].number",
    ])
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map(Number);
}

/**
 * The OAuth scopes of the token `gh` authenticates with, from the
 * `X-OAuth-Scopes` response header, or `null` when they cannot be read.
 *
 * `null` is UNREADABLE, not empty: a fine-grained PAT or an offline run sends
 * no such header, and a caller that gates on a scope must fail closed on it
 * rather than read "no scopes" and "no evidence" as the same thing.
 */
export function parseTokenScopes(headers: string): string[] | null {
    const line = headers
        .split(/\r?\n/)
        .find((l) => /^x-oauth-scopes\s*:/i.test(l));
    if (line === undefined) return null;
    return line
        .slice(line.indexOf(":") + 1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

let tokenScopesCache: { value: string[] | null } | undefined;

/** Test seam: forget the per-process scope read. */
export function resetTokenScopesCache(): void {
    tokenScopesCache = undefined;
}

/**
 * The developer token's scopes, read ONCE per process (one `gh api` call) and
 * cached — including a failed read, so an offline run does not retry per
 * issue. `null` = unreadable (see `parseTokenScopes`).
 */
export function ghTokenScopes(): string[] | null {
    if (tokenScopesCache) return tokenScopesCache.value;
    let value: string[] | null;
    try {
        value = parseTokenScopes(gh(["api", "-i", "/"]));
    } catch {
        value = null;
    }
    tokenScopesCache = { value };
    return value;
}
