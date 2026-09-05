#!/usr/bin/env bun
// `bun run queue:plan` — print the next `/process-gh-issues` fan-out batch as JSON.
//
// This wrapper holds NO decisions. It fetches, calls `planBatch`, and prints.
// Everything the loop used to derive from prose lives in `lib/queue-plan.ts`,
// where it is pure and tested; keeping the wrapper decision-free is what makes
// that true (a rule quietly re-implemented here would be untested again).
//
// Usage:
//   bun run queue:plan                 # default batch cap
//   bun run queue:plan --cap 2
//   bun run queue:plan --limit 100     # how deep to read the queue
//   bun run queue:plan --pretty
//   bun run queue:plan --inferred '{"2104":["convex/cards/sets/ice/**"]}'
//
// The `--inferred` map is the fallback for issues predating the `Target files:`
// convention: run once, read which candidates came back with an unknown blast
// radius, infer their file sets, re-run with the map. The planner refuses to
// guess; supplying the guess is the orchestrator's job, and doing it explicitly
// keeps the plan reproducible.
//
// The `gh` round-trips are the only I/O: one list call, then one body fetch per
// candidate the planner actually considers (plus one per dependency it has to
// resolve). Selection cost scales with the batch, not the queue.

import {
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { gh } from "./lib/gh";
import {
    fetchBoardPriority as fetchBoardPriorityShared,
    NO_PRIORITY_WARNING,
    VALID_PRIORITIES,
} from "./lib/board-priority";
import {
    buildPlanRecord,
    planBatch,
    planFilename,
    type BoardPriority,
    type IssueDetail,
    type PlanConfig,
    type QueueIssue,
    type QueuePort,
} from "./lib/queue-plan";

// Computed the same way scripts/__tests__/land.test.ts computes it (from a
// FILE's own directory, not from `import.meta.dir`, which is bun-only and
// would throw when this module is imported under vitest for its pure
// functions).
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULTS = {
    cap: 4,
    // Deep enough to see the WHOLE queue, not a window of it.
    //
    // The loop's original query used `--limit 60`, and `gh issue list` returns
    // NEWEST first — so with 176 open `ready-for-agent` issues it saw #2077 to
    // #2190 and nothing else: 126 issues, back to #1215, were invisible to
    // every pass. The lineage sort was ordering a window that had already
    // excluded everything old, which is precisely the starvation the lineage
    // sort exists to prevent (issue #2188, measured 2026-08-04).
    //
    // Raising it is free NOW and was not before: the list is consumed inside
    // this process and only the plan crosses into the model's context. At the
    // old shape the same change would have cost ~27k tokens of context per
    // pass. Silent truncation of a `gh` query is a recurring class here — the
    // default `--limit` is 30, and the previous instance of this bug also
    // under-counted a queue.
    limit: 300,
    staleClaimHours: 24,
    // The tier for every issue carrying no `model:*` label — which, since
    // `model:sonnet` was retired as pure noise, is the VAST MAJORITY of the
    // queue rather than a residue. The tracker keeps only the escalation
    // labels (`model:opus`, `model:fable`), so "unlabelled" now means "default
    // tier", not "nobody triaged it".
    //
    // Consequence, and the reason this is spelled out: changing this value
    // silently re-routes the whole unlabelled queue. It is a fleet-wide cost
    // and quality change, not a default tweak — if you change it, review what
    // it re-routes rather than assuming the labelled issues are the affected
    // ones.
    defaultImplModel: "sonnet",
};

function arg(name: string, fallback: number): number {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = Number(process.argv[i + 1]);
    if (!Number.isFinite(value)) {
        console.error(`✗ --${name} needs a number`);
        process.exit(2);
    }
    return value;
}

/** Issues with an open PR — the liveness signal that keeps a long-running claim
 *  from being swept. Derived from the head branch name, because that branch is
 *  the loop's atomic ownership claim (`feat/issue-N` / `fix/issue-N`). */
function issuesWithOpenPr(): number[] {
    const prs = JSON.parse(
        gh([
            "pr",
            "list",
            "--state",
            "open",
            "--json",
            "headRefName",
            "--limit",
            "100",
        ])
    ) as { headRefName: string }[];
    return prs
        .map((pr) => /^(?:feat|fix)\/issue-(\d+)$/.exec(pr.headRefName)?.[1])
        .filter((n): n is string => n !== undefined)
        .map(Number);
}

// ─────────────────────────────────────────────────────────────────────────────
// Board priority — the maintainer's live override.
//
// The `Priority` single-select on the GitHub Project board is the one input
// whose criteria change week to week, so it cannot live on the issues: baking a
// priority into 265 issues means every change of mind is 265 edits. It is read
// here, at pick time, and applied as the planner's zeroth sort key.
//
// Reading it is ONE call for the whole board, which is why `QueuePort.priority`
// is a map rather than a lookup — a per-issue call would invent the round-trip
// the two-stage design exists to avoid.
//
// It is also a GraphQL call over a 400+-item board, and `gh` has a SEPARATE,
// much tighter GraphQL budget than REST (issue #2520: GraphQL sat at 29/5000
// remaining while REST sat at 4994/5000). With several sessions draining the
// queue in parallel, that budget is gone within the hour — so the read is
// CACHED to a shared file (§ below) and, on a rate-limit failure with a usable
// cached snapshot, the plan degrades to it rather than stopping. Only when
// there is no usable snapshot at all does the hard stop remain correct: a
// batch silently ordered on stale DEFAULTS (not a stale snapshot — the
// absence of the maintainer's override entirely) looks completely normal and
// nothing goes red.
// ─────────────────────────────────────────────────────────────────────────────

const PROJECT_OWNER = process.env.TOLARIA_PROJECT_OWNER ?? "fil-donadoni";
const PROJECT_NUMBER = process.env.TOLARIA_PROJECT_NUMBER ?? "2";
const PROJECT_REPO = process.env.TOLARIA_PROJECT_REPO ?? "fil-donadoni/tolaria";

/** Used ONLY when the board's own `totalCount` cannot be read (CLI shape
 *  drift) — the read is normally sized to `computeItemLimit`'s first
 *  argument, never to a static guess. Kept deep enough for the whole board
 *  with room to grow, matching the historical default. */
const PROJECT_ITEM_LIMIT_FALLBACK = 2000;

function die(message: string): never {
    console.error(`✗ ${message}`);
    process.exit(2);
}

/** The GitHub CLI's own wording for an exhausted GraphQL budget
 *  (`GraphQL: API rate limit exceeded for user ID …`). Matched loosely on
 *  purpose — the id and phrasing around it are not contractual, "rate limit"
 *  is. */
export function isRateLimitError(message: string): boolean {
    return /rate limit/i.test(message);
}

/** A cached snapshot is fresh enough to REUSE (skip the fetch, make no
 *  GraphQL call at all) only inside the TTL. This is the ONLY thing the TTL
 *  governs — see `resolveBoardPriority`: a snapshot past it is still usable
 *  as a rate-limit fallback, just not as a silent stand-in for a live read. */
export function isCacheFresh(
    now: string,
    fetchedAt: string,
    ttlMs: number
): boolean {
    const age = Date.parse(now) - Date.parse(fetchedAt);
    return Number.isFinite(age) && age >= 0 && age <= ttlMs;
}

/** Human-readable snapshot age for the degraded-read announcement
 *  (`… snapshot from 3m ago`). Minutes below an hour, `${h}h${m}m` above. */
export function formatSnapshotAge(now: string, fetchedAt: string): string {
    const ms = Math.max(0, Date.parse(now) - Date.parse(fetchedAt));
    if (ms < 60000) return "<1m";
    const minutes = Math.round(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const rem = minutes % 60;
    return rem === 0 ? `${hours}h` : `${hours}h${rem}m`;
}

/** Derived from the shared reader's own wording so the two cannot drift: this
 *  script handles `--no-priority` before the reader is ever called (the
 *  documented escape hatch must touch neither the cache nor the network), but
 *  an operator must see the same sentence either way. */
export const NO_PRIORITY_MESSAGE = `⚠ ${NO_PRIORITY_WARNING}`;

export function rateLimitFallbackMessage(ageLabel: string): string {
    return `⚠ board unread (GraphQL rate limit); using the priority snapshot from ${ageLabel} ago`;
}

export interface BoardPrioritySnapshot {
    fetchedAt: string;
    priority: Record<number, BoardPriority>;
}

export interface BoardPriorityDeps {
    /** ISO timestamp — injected so cache-age decisions are deterministic. */
    now: string;
    ttlMs: number;
    readCache: () => BoardPrioritySnapshot | undefined;
    /** May throw (EACCES, ENOSPC, a concurrent writer) — `resolveBoardPriority`
     *  treats that as best-effort and never lets it turn a successful live
     *  read into a failure. */
    writeCache: (snapshot: BoardPrioritySnapshot) => void;
    /** Throws on any read failure (rate limit or otherwise) — the caller
     *  classifies what to do about it. */
    fetchLive: () => Record<number, BoardPriority>;
}

export type BoardPriorityResult =
    | { priority: Record<number, BoardPriority>; source: "cache-fresh" }
    | { priority: Record<number, BoardPriority>; source: "live" }
    | {
          priority: Record<number, BoardPriority>;
          source: "cache-stale-fallback";
          ageLabel: string;
      };

/**
 * The three-outcome contract (issue #2520): fresh cache (reuse, no live call),
 * stale-but-present cache used ONLY after a live read fails (announced with
 * its age), and — when the live read fails with nothing cached at all — the
 * failure propagates so the caller can hard-stop exactly as before.
 *
 * A non-rate-limit failure (auth, CLI shape drift) is NEVER papered over by a
 * cache, however fresh: only a rate-limit-shaped error degrades.
 *
 * The cache WRITE is deliberately outside the try/catch that classifies
 * `fetchLive` failures: a write failure (EACCES, ENOSPC, a concurrent writer
 * on the shared cache file) is not rate-limit shaped, so it used to rethrow
 * and turn a live read that had ALREADY SUCCEEDED — priorities in hand — into
 * a hard stop caused entirely by the caching layer meant to prevent hard
 * stops. It is now best-effort: a failed write only costs the next pass's
 * cache-fresh skip, never this one's result.
 */
export function resolveBoardPriority(
    deps: BoardPriorityDeps
): BoardPriorityResult {
    const cached = deps.readCache();

    if (cached && isCacheFresh(deps.now, cached.fetchedAt, deps.ttlMs)) {
        return { priority: cached.priority, source: "cache-fresh" };
    }

    let priority: Record<number, BoardPriority>;
    try {
        priority = deps.fetchLive();
    } catch (err) {
        if (cached && isRateLimitError((err as Error).message)) {
            return {
                priority: cached.priority,
                source: "cache-stale-fallback",
                ageLabel: formatSnapshotAge(deps.now, cached.fetchedAt),
            };
        }
        throw err;
    }

    try {
        deps.writeCache({ fetchedAt: deps.now, priority });
    } catch {
        // Best-effort — see the function comment above. The live read already
        // succeeded; a write failure must not be reported to the caller.
    }
    return { priority, source: "live" };
}

/** Adds the `--no-priority` escape (unchanged behaviour: announces itself,
 *  makes no cache/live call at all) around `resolveBoardPriority`, and turns
 *  its result into the one message the caller prints, if any. Pure aside from
 *  the injected `deps` — the whole decision is testable with fakes. */
export function boardPriorityForArgv(
    argv: string[],
    deps: BoardPriorityDeps
): { priority: Record<number, BoardPriority>; message?: string } {
    if (argv.includes("--no-priority")) {
        return { priority: {}, message: NO_PRIORITY_MESSAGE };
    }
    const result = resolveBoardPriority(deps);
    if (result.source === "cache-stale-fallback") {
        return {
            priority: result.priority,
            message: rateLimitFallbackMessage(result.ageLabel),
        };
    }
    return { priority: result.priority };
}

const BOARD_PRIORITY_CACHE_REL = join(
    ".claude",
    "telemetry",
    "board-priority.json"
);
// A few minutes: short enough that a maintainer's board edit is visible to
// the next pass or two, long enough that five sessions draining the queue in
// the same window pay for one board read instead of five.
const BOARD_PRIORITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Exported for direct testing — the validation here is load-bearing: an
 * unparseable `fetchedAt` would still qualify as a usable fallback and print
 * "snapshot from NaNhNaNm ago", and a cached priority outside
 * `VALID_PRIORITIES` would reach `PRIORITY_RANK` as `undefined` and make the
 * sort comparator return `NaN` — neither defect the live path allows (the
 * shared reader reports both, and this script's `onError` turns that into a
 * `die()`).
 */
export function readBoardPriorityCache(
    cachePath: string
): BoardPrioritySnapshot | undefined {
    try {
        const raw = readFileSync(cachePath, "utf8");
        const parsed = JSON.parse(raw) as Partial<BoardPrioritySnapshot>;
        if (
            typeof parsed.fetchedAt !== "string" ||
            typeof parsed.priority !== "object" ||
            parsed.priority === null ||
            Number.isNaN(Date.parse(parsed.fetchedAt))
        ) {
            return undefined;
        }
        const priority = parsed.priority as Record<string, unknown>;
        for (const value of Object.values(priority)) {
            if (
                typeof value !== "string" ||
                !VALID_PRIORITIES.includes(value as BoardPriority)
            ) {
                return undefined;
            }
        }
        return {
            fetchedAt: parsed.fetchedAt,
            priority: priority as Record<number, BoardPriority>,
        };
    } catch {
        // Missing file, corrupt JSON, wrong shape — all read the same as "no
        // usable snapshot" to the caller, which is exactly the distinction
        // the hard-stop path needs to keep making correctly.
        return undefined;
    }
}

/** Exported for direct testing. Several loops share this cache file
 *  concurrently; a bare `writeFileSync` (open O_TRUNC then write) lets a
 *  concurrent reader observe a truncated/zero-filled snapshot mid-write.
 *  Write to a sibling temp file and `renameSync` over the target — rename is
 *  atomic on the same filesystem, so a reader always sees either the old
 *  snapshot or the fully-written new one, never a partial one. */
export function writeBoardPriorityCache(
    cachePath: string,
    snapshot: BoardPrioritySnapshot
): void {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.tmp.${process.pid}`;
    writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2) + "\n");
    renameSync(tmpPath, cachePath);
}

/** Every degraded read the SHARED reader reports (`lib/board-priority.ts`)
 *  arrives here as a throw rather than a `die()`, because this caller has one
 *  more decision to make first: a rate-limit-shaped failure may degrade to a
 *  cached snapshot (issue #2520), and only what survives that classification
 *  becomes a hard stop. The reader's own `onError` messages already carry the
 *  operator guidance, so they are re-emitted verbatim. */
class BoardReadError extends Error {}

/**
 * Read the board's `Priority` column over the network, through the reader
 * shared with `loop:status` (#2519). Throws verbatim on any failure — `gh`
 * itself failing (including a rate limit), a CLI shape change, a truncated
 * list, an unranked `Priority` value — because the caller
 * (`resolveBoardPriority`) is what decides whether that is recoverable.
 *
 * `read` is a test seam only — the real reader is the default.
 */
export function liveFetchBoardPriority(
    read: typeof fetchBoardPriorityShared = fetchBoardPriorityShared
): Record<number, BoardPriority> {
    return read({
        owner: PROJECT_OWNER,
        projectNumber: PROJECT_NUMBER,
        repo: PROJECT_REPO,
        // The FALLBACK only: the reader sizes the window to the board's own
        // `totalCount` (`computeItemLimit`) and proves it wasn't truncated
        // (`isPossiblyTruncated`) — both properties of the read itself, so
        // both live with it.
        itemLimit: PROJECT_ITEM_LIMIT_FALLBACK,
        // `--no-priority` never reaches here: `boardPriorityForArgv` returns
        // before the cache or the network is touched, so `skip` would be dead
        // weight — and routing the escape hatch through a throwing `onError`
        // is exactly the shape PR #2545's review found deletes it.
        onError: (message) => {
            throw new BoardReadError(message);
        },
    });
}

/**
 * FAIL-LOUD on every degraded read with no usable fallback. Producing a plan
 * without the priorities is strictly worse than producing no plan: the batch
 * looks completely normal, the loop implements four issues in the wrong
 * order, and nothing anywhere is red. A stopped loop is a five-second fix; a
 * silently mis-ordered one is invisible. `--no-priority` is the explicit
 * escape, and it announces itself.
 */
function fetchBoardPriority(): Record<number, BoardPriority> {
    const cachePath = join(REPO_ROOT, BOARD_PRIORITY_CACHE_REL);
    try {
        const { priority, message } = boardPriorityForArgv(process.argv, {
            now: new Date().toISOString(),
            ttlMs: BOARD_PRIORITY_CACHE_TTL_MS,
            readCache: () => readBoardPriorityCache(cachePath),
            writeCache: (snapshot) =>
                writeBoardPriorityCache(cachePath, snapshot),
            fetchLive: liveFetchBoardPriority,
        });
        if (message) console.error(message);
        return priority;
    } catch (err) {
        // A `BoardReadError` is the shared reader's own operator-facing
        // message (access, truncation, an unranked value) — it already says
        // what to do, so re-emit it verbatim rather than burying it under a
        // wrapper that names only the access case. Anything else reaching
        // here is unexpected (a malformed `gh` payload, say), and the wrapper
        // is what gives it context.
        if (err instanceof BoardReadError) die(err.message);
        die(
            `cannot read project ${PROJECT_OWNER}/${PROJECT_NUMBER}: ${(err as Error).message}\n` +
                `  The board carries the Priority field the queue sorts on, so this plan would be\n` +
                `  silently mis-ordered. Fix the access — \`gh auth refresh -s read:project\` — or\n` +
                `  re-run with --no-priority to plan on the default order deliberately.`
        );
    }
}

function inferredTargetFiles(): Record<number, string[]> | undefined {
    const i = process.argv.indexOf("--inferred");
    if (i === -1) return undefined;
    const raw = process.argv[i + 1];
    if (!raw) {
        console.error("✗ --inferred needs a JSON object, or a path to one");
        process.exit(2);
    }
    const text = raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8");
    try {
        return JSON.parse(text) as Record<number, string[]>;
    } catch (err) {
        console.error(
            `✗ --inferred is not valid JSON: ${(err as Error).message}`
        );
        process.exit(2);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan artefact (issue #2518) — durable record of what THIS run produced, so
// a later audit can tell "planned batch" from "hand-picked claim". Written to
// `.claude/telemetry/plans/`, gitignored wholesale under `.claude/telemetry/`
// and pruned like the sibling `pass-markers` directory (deny-guard.sh §5).
//
// The session id is the join key `claim-ledger.sh` needs: it reads
// `.session_id` off its own hook payload for every claim, and that is the
// SAME id Claude Code exposes to a Bash tool call as `CLAUDE_CODE_SESSION_ID`
// — confirmed against this very run (the orchestrator's session id IS the
// `BATCH_ID` every subagent receipt is keyed by, see `scripts/lib/receipt.ts`
// "Batch-scoped, keyed by the orchestrator's SESSION id"). Falling back to
// empty string when the env var is absent (a manual, non-Claude-Code
// invocation) is deliberate — `planFilename` turns that into `"unknown"`
// rather than a guessed id that would falsely join to some other session's
// claims.
// ─────────────────────────────────────────────────────────────────────────────

const PLANS_RETENTION_DAYS = 7;

function pruneOldPlans(dir: string): void {
    const cutoff = Date.now() - PLANS_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    let entries: string[];
    try {
        entries = readdirSync(dir);
    } catch {
        return;
    }
    for (const name of entries) {
        const full = join(dir, name);
        try {
            if (statSync(full).mtimeMs < cutoff) {
                unlinkSync(full);
            }
        } catch {
            // best-effort — a prune failure must never fail the plan itself
        }
    }
}

/**
 * Write the durable plan artefact. Best-effort and never fatal: the plan
 * this process prints to stdout is the contract every caller relies on, and
 * a telemetry write failing must not take that down with it.
 *
 * `now` is passed in rather than read here so the artefact carries the SAME
 * timestamp the plan was computed with (`PlanConfig.now`), which is what
 * `claim-ledger.sh` sorts filenames by.
 */
function writePlanArtefact(
    plan: ReturnType<typeof planBatch>,
    now: string
): void {
    try {
        const dir = join(process.cwd(), ".claude/telemetry/plans");
        mkdirSync(dir, { recursive: true });
        pruneOldPlans(dir);
        const session = process.env.CLAUDE_CODE_SESSION_ID ?? "";
        const noPriority = process.argv.includes("--no-priority");
        const record = buildPlanRecord(plan, session, now, noPriority);
        const file = join(dir, planFilename(session, now));
        writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
    } catch (err) {
        console.error(
            `⚠ could not write plan artefact: ${(err as Error).message}`
        );
    }
}

function main(): void {
    const limit = arg("limit", DEFAULTS.limit);

    const issues = JSON.parse(
        gh([
            "issue",
            "list",
            "--label",
            "ready-for-agent",
            "--state",
            "open",
            "--json",
            "number,title,labels,parent,assignees,updatedAt",
            "--limit",
            String(limit),
        ])
    ) as QueueIssue[];

    const detailCache = new Map<number, IssueDetail>();

    const port: QueuePort = {
        issuesWithOpenPr: issuesWithOpenPr(),
        priority: fetchBoardPriority(),
        issueDetail(number: number): IssueDetail {
            const cached = detailCache.get(number);
            if (cached) return cached;
            const raw = JSON.parse(
                gh([
                    "issue",
                    "view",
                    String(number),
                    "--json",
                    "state,labels,body",
                ])
            ) as { state: string; labels: { name: string }[]; body: string };
            const detail: IssueDetail = {
                state: raw.state === "CLOSED" ? "CLOSED" : "OPEN",
                labels: raw.labels.map((l) => l.name),
                body: raw.body ?? "",
            };
            detailCache.set(number, detail);
            return detail;
        },
    };

    const config: PlanConfig = {
        batchCap: arg("cap", DEFAULTS.cap),
        staleClaimHours: arg("stale-hours", DEFAULTS.staleClaimHours),
        defaultImplModel: DEFAULTS.defaultImplModel,
        now: new Date().toISOString(),
        inferredTargetFiles: inferredTargetFiles(),
        // Opt-in, and only the AFK driver passes it (#3088): an interactive
        // session is the human an HITL flag is asking for, so it keeps seeing
        // that work. See `PlanConfig.excludeHitl`.
        excludeHitl: process.argv.includes("--exclude-hitl"),
    };

    const plan = planBatch(issues, config, port);

    writePlanArtefact(plan, config.now);

    process.stdout.write(
        JSON.stringify(plan, null, process.argv.includes("--pretty") ? 2 : 0) +
            "\n"
    );
}

if (import.meta.main) {
    main();
}
