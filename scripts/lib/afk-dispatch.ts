// The AFK dispatcher's decisions (issue #5649, PRD #5620, ADR 0156
// Amendment I § The pass is dispatched, not just triggered).
//
// ONE dispatcher run at a time (`.github/workflows/afk-dispatch.yml`'s
// concurrency group) reads the queue, the runners, the passes' runs and
// records, and the health verdict; this module turns those facts into:
//
//   * a HOLD — dispatch nothing this time, and say why: the base is RED, a
//     usage-limit reset time has not passed, the token budget is spent, or
//     three consecutive passes failed (the one hold that fails the run, once,
//     so GitHub sends one email rather than one per sweep);
//   * an AGED REPAIR notice — under a hold, a `land-failed` PR waiting past
//     `afkDispatch.repairAgeHours` fails the run once too (issue #5957);
//   * the CLAIM FACTS the picker (`lib/picker.ts`) judges claims by — which
//     claims a live `afk-pass` run, an open PR in the queue or a session
//     outside the pipeline still holds;
//   * the DISPATCHES — as many as there are free `pass` runner slots, dead
//     passes' pushed work first (pinned to the host that ran them while that
//     host is online), then the picker's plan.
//
// PURE — no clock, no network, no git: `scripts/afk-dispatch.ts` gathers the
// facts and performs the claims, releases and dispatches.

import {
    sumWindow,
    weightedTokens,
    pctOfBudget,
    DEFAULT_WEIGHTS,
    type Categories,
    type CategoryWeights,
    type UsageRecord,
    type WeightClass,
} from "./usage-window";
import { claimFate, type JudgedClaim, type PickResult } from "./picker";
import type { PassRunState } from "./claim-verdict";
import type { HealthMarker, RepairItem } from "./queue-plan";
import { CLAIM_LABEL } from "./claim-labels";
import { FAILED_LABEL, READY_LABEL } from "./land-labels";

// ─────────────────────────────────────────────────────────────────────────
// Conventions shared with `afk-pass.yml` (issue #5650)
// ─────────────────────────────────────────────────────────────────────────

/** The pass workflow the dispatcher dispatches. Absent on the default
 *  branch = the dispatcher has nothing to dispatch to and holds. */
export const PASS_WORKFLOW = "afk-pass.yml";

/** `afk-pass.yml`'s `run-name` starts with this, then the issue number:
 *  `afk-pass #5649`. It is how a run names its claim without a per-run API
 *  call. */
export const PASS_RUN_PREFIX = "afk-pass #";

/** The artifact each pass uploads: one `PassRecord` as `record.json`. */
export const PASS_RECORD_ARTIFACT = "afk-pass-record";

/** `afk-dispatch.yml`'s `run-name` carries this when the owner dispatched it
 *  with `ack_failures` — the end of a failure streak (see `failureStreak`). */
export const ACK_MARKER = "failures acknowledged";

/** Consecutive failed passes that pause the dispatcher (ADR 0156 Amendment
 *  I: "a pause after three consecutive failed passes"). */
export const FAILURE_STREAK_LIMIT = 3;

/** Run conclusions that count as a FAILED pass. `cancelled` (the kill
 *  switch, a paused runner) and `skipped` say nothing about the pass and are
 *  passed over; everything else ends a streak. */
const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);
const NEUTRAL_CONCLUSIONS = new Set(["cancelled", "skipped", ""]);

/** The issue a pass run is for, from its run name; `null` for any other
 *  title (a hand-dispatched run without the convention). */
export function passRunIssue(title: string): number | null {
    if (!title.startsWith(PASS_RUN_PREFIX)) return null;
    const m = /^(\d+)\b/.exec(title.slice(PASS_RUN_PREFIX.length));
    return m ? Number(m[1]) : null;
}

/** One `afk-pass` (or `afk-dispatch`) workflow run, as `gh run list` reads it. */
export interface WorkflowRun {
    id: number;
    title: string;
    /** `queued`, `in_progress`, `completed`, `waiting`, `pending`, `requested`. */
    status: string;
    /** Set once `completed`: `success`, `failure`, `cancelled`, … */
    conclusion: string | null;
    createdAt: string;
    updatedAt: string;
}

/** The `gh run list --json` fields a `WorkflowRun` is read from. */
export const WORKFLOW_RUN_FIELDS =
    "databaseId,displayTitle,status,conclusion,createdAt,updatedAt";

/** `gh run list --json WORKFLOW_RUN_FIELDS` → `WorkflowRun`s. Throws on a
 *  torn answer: the caller decides what unreadable means. */
export function parseWorkflowRuns(text: string): WorkflowRun[] {
    const rows = JSON.parse(text) as {
        databaseId: number;
        displayTitle: string;
        status: string;
        conclusion: string | null;
        createdAt: string;
        updatedAt: string;
    }[];
    return rows.map((r) => ({
        id: r.databaseId,
        title: r.displayTitle,
        status: r.status,
        conclusion: r.conclusion || null,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    }));
}

const isActive = (r: WorkflowRun): boolean => r.status !== "completed";

/** Issues a not-yet-finished `afk-pass` run holds: a repair already under way
 *  is not dispatched again (issue #6795). */
export function livePassIssues(passRuns: readonly WorkflowRun[]): Set<number> {
    const live = new Set<number>();
    for (const r of passRuns) {
        const n = passRunIssue(r.title);
        if (n !== null && isActive(r)) live.add(n);
    }
    return live;
}
const isWaiting = (r: WorkflowRun): boolean =>
    isActive(r) && r.status !== "in_progress";
const ms = (iso: string): number => Date.parse(iso);

// ─────────────────────────────────────────────────────────────────────────
// The pass record
// ─────────────────────────────────────────────────────────────────────────

/**
 * What one pass leaves behind for the dispatcher and the weekly report — the
 * job summary's numbers as JSON, no Claude output (ADR 0156 Amendment I §
 * Public logs). Written by `afk-pass` (issue #5650).
 */
export interface PassRecord {
    version: 1;
    issue: number;
    pr: number | null;
    outcome: string;
    /** The machine the pass ran on (`host:<name>` label's name). */
    host: string;
    startedAt: string;
    endedAt: string;
    durationS: number;
    /** Tokens per model, `usage-window`'s categories — weighted here by the
     *  same table the local reading uses, so one machine's pass and the
     *  other's transcript are one currency. */
    models: Record<string, Categories>;
    costUsd: number | null;
    /** When the pass hit the subscription's usage limit: when it resets. */
    usageLimitResetAt: string | null;
}

const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;

/** A record read off an artifact, or `null` for anything malformed — one
 *  torn artifact must not stop the dispatcher. */
export function parsePassRecord(text: string): PassRecord | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof raw !== "object" || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (r.version !== 1) return null;
    if (typeof r.issue !== "number" || typeof r.host !== "string") return null;
    if (typeof r.endedAt !== "string" || !Number.isFinite(ms(r.endedAt)))
        return null;
    const models: Record<string, Categories> = {};
    if (typeof r.models === "object" && r.models !== null) {
        for (const [model, c] of Object.entries(
            r.models as Record<string, Record<string, unknown>>
        )) {
            if (typeof c !== "object" || c === null) continue;
            models[model] = {
                input: num(c.input),
                output: num(c.output),
                cacheCreation: num(c.cacheCreation),
                cacheRead: num(c.cacheRead),
            };
        }
    }
    const reset =
        typeof r.usageLimitResetAt === "string" &&
        Number.isFinite(ms(r.usageLimitResetAt))
            ? r.usageLimitResetAt
            : null;
    return {
        version: 1,
        issue: r.issue,
        pr: typeof r.pr === "number" ? r.pr : null,
        outcome: typeof r.outcome === "string" ? r.outcome : "unknown",
        host: r.host,
        startedAt: typeof r.startedAt === "string" ? r.startedAt : r.endedAt,
        endedAt: r.endedAt,
        durationS: num(r.durationS),
        models,
        costUsd: typeof r.costUsd === "number" ? r.costUsd : null,
        usageLimitResetAt: reset,
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Holds
// ─────────────────────────────────────────────────────────────────────────

export interface BudgetConfig {
    /** Weighted tokens per window (`usage:window`'s unit); `<= 0` = unset. */
    budget: number;
    /** Percentage of `budget` past which nothing new is dispatched. */
    maxPct: number;
    /** The trailing window, hours. */
    hours: number;
}

export interface BudgetReading {
    weighted: number;
    pct: number;
    /** Of `weighted`, what the other machines' pass records added. */
    remote: number;
}

/**
 * The budget reading: this machine's own transcripts (every session on it —
 * the owner's and the passes it ran) plus the pass records of OTHER machines
 * that ended inside the window. A record of this machine is skipped: its
 * tokens are already in the local transcripts. A record that started before
 * the window counts whole — the reading errs toward spent.
 */
export function budgetReading(
    local: Record<string, Categories>,
    records: readonly PassRecord[],
    thisHost: string,
    sinceMs: number,
    budget: number,
    weights: Record<WeightClass, CategoryWeights> = DEFAULT_WEIGHTS
): BudgetReading {
    const localWeighted = weightedTokens({ models: local }, weights);
    const remoteRows: UsageRecord[] = records
        .filter((r) => r.host !== thisHost && ms(r.endedAt) >= sinceMs)
        .flatMap((r) =>
            Object.entries(r.models).map(([model, c]) => ({
                tsMs: ms(r.endedAt),
                model,
                ...c,
            }))
        );
    const remote = weightedTokens(sumWindow(remoteRows, sinceMs), weights);
    const weighted = localWeighted + remote;
    return { weighted, pct: pctOfBudget(weighted, budget), remote };
}

/** The latest usage-limit reset still in the future, or `null`. */
export function usageLimitResetAt(
    records: readonly PassRecord[],
    nowMs: number
): string | null {
    let best: string | null = null;
    for (const r of records) {
        const at = r.usageLimitResetAt;
        if (at === null || ms(at) <= nowMs) continue;
        if (best === null || ms(at) > ms(best)) best = at;
    }
    return best;
}

export interface FailureStreak {
    /** Consecutive failed passes, newest first, since the last ack. */
    runs: WorkflowRun[];
    /** The streak reached the limit and no dispatcher run has failed since:
     *  THIS run fails, so GitHub sends the one email. */
    notify: boolean;
}

/**
 * The failure streak: completed pass runs, newest first, after the owner's
 * last acknowledgement (a dispatcher run whose name carries `ACK_MARKER`),
 * counted until the first that did not fail; a neutral conclusion is passed
 * over. `notify` holds until a dispatcher run has FAILED (completed) since
 * the moment the streak reached the limit — one email per streak, not one
 * per sweep.
 */
export function failureStreak(
    passRuns: readonly WorkflowRun[],
    dispatchRuns: readonly WorkflowRun[]
): FailureStreak {
    const acks = dispatchRuns
        .filter((r) => r.title.includes(ACK_MARKER))
        .map((r) => ms(r.createdAt));
    const ackMs = acks.length ? Math.max(...acks) : -Infinity;
    const completed = passRuns
        .filter((r) => !isActive(r) && ms(r.updatedAt) > ackMs)
        .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
    const runs: WorkflowRun[] = [];
    for (const r of completed) {
        const c = r.conclusion ?? "";
        if (FAILED_CONCLUSIONS.has(c)) runs.push(r);
        else if (!NEUTRAL_CONCLUSIONS.has(c)) break;
    }
    if (runs.length < FAILURE_STREAK_LIMIT) return { runs, notify: false };
    const reachedMs = ms(runs[runs.length - FAILURE_STREAK_LIMIT].updatedAt);
    // By COMPLETION time: the dispatcher run a failing pass sends at its end
    // is CREATED before that pass completes, yet it is the one that emails.
    const notified = dispatchRuns.some(
        (r) => r.conclusion === "failure" && ms(r.updatedAt) >= reachedMs
    );
    return { runs, notify: !notified };
}

export type Hold =
    | { kind: "disabled"; message: string }
    | { kind: "no-pass-workflow"; message: string }
    | { kind: "unknown-health"; message: string }
    | { kind: "records-unknown"; message: string }
    | { kind: "failure-streak"; message: string; notify: boolean }
    | { kind: "red"; message: string }
    | { kind: "usage-limit"; message: string; until: string }
    | { kind: "no-budget"; message: string }
    | { kind: "budget"; message: string; reading: BudgetReading };

export interface HoldInput {
    /** `afk-dispatch.yml` itself is enabled: a run queued before the kill
     *  switch still executes, and must start nothing. */
    dispatcherActive: boolean;
    /** The health verdict store could not be read: unattended, that holds. */
    healthError: string | null;
    /** Completed pass runs in the window whose record could not be read —
     *  their tokens and usage-limit reset would be missing from the reading. */
    missingRecords: number;
    /** `afk-pass.yml` exists and is enabled on the default branch. */
    passWorkflowActive: boolean;
    streak: FailureStreak;
    red: HealthMarker | null;
    usageLimitResetAt: string | null;
    budget: BudgetConfig;
    reading: BudgetReading;
}

/**
 * The first hold that applies, or `null`. Order: the kill switch (a run
 * queued before it), a missing pass workflow (nothing to dispatch to), the
 * failure streak (the owner must look), an unreadable health verdict, RED
 * (ADR 0116: no work on a broken tip; the fixer is `health-fix.yml`'s, never
 * dispatched here), unreadable pass records, the usage-limit reset, then the
 * budget — which fails CLOSED when unset (ADR 0109: never unbudgeted).
 * Every unknown fact holds: the dispatcher runs unattended.
 */
export function holdFor(input: HoldInput): Hold | null {
    if (!input.dispatcherActive)
        return {
            kind: "disabled",
            message:
                "afk-dispatch.yml is disabled (the kill switch) — nothing starts",
        };
    if (!input.passWorkflowActive)
        return {
            kind: "no-pass-workflow",
            message: `${PASS_WORKFLOW} is absent or disabled on the default branch — nothing to dispatch to`,
        };
    const { streak } = input;
    if (streak.runs.length >= FAILURE_STREAK_LIMIT)
        return {
            kind: "failure-streak",
            notify: streak.notify,
            message:
                `${streak.runs.length} consecutive failed passes (runs ${streak.runs
                    .slice(0, FAILURE_STREAK_LIMIT)
                    .map((r) => r.id)
                    .join(", ")}) — paused. ` +
                `Read the runs, then \`gh workflow run afk-dispatch.yml -f ack_failures=true\` to resume`,
        };
    if (input.healthError !== null)
        return {
            kind: "unknown-health",
            message: `the health verdict could not be read (${input.healthError}) — no new pass on an unknown base`,
        };
    if (input.red)
        return {
            kind: "red",
            message: `the base is RED @ ${(input.red.sha ?? "unknown").slice(0, 8)} (${input.red.failedStep ?? "unknown step"}) — no new pass until health is GREEN or AMBER`,
        };
    if (input.usageLimitResetAt)
        return {
            kind: "usage-limit",
            until: input.usageLimitResetAt,
            message: `a pass hit the usage limit — held until ${input.usageLimitResetAt}`,
        };
    if (input.missingRecords > 0)
        return {
            kind: "records-unknown",
            message: `${input.missingRecords} pass record(s) in the window could not be read — the budget and usage-limit facts are incomplete`,
        };
    const { budget, reading } = input;
    if (!(budget.budget > 0) || !(budget.hours > 0))
        return {
            kind: "no-budget",
            message:
                "no token budget configured (repository variable AFK_TOKEN_BUDGET) — the dispatcher never runs unbudgeted",
        };
    if (reading.pct >= budget.maxPct)
        return {
            kind: "budget",
            reading,
            message: `token budget spent: ${reading.pct.toFixed(1)}% of ${budget.budget} over ${budget.hours} h (ceiling ${budget.maxPct}%)`,
        };
    return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Aged repair picks (issue #5957)
// ─────────────────────────────────────────────────────────────────────────

/** The dispatcher's own `tolaria.config.json` block, read by this module
 *  ONLY. */
export interface AfkDispatchConfig {
    /** Hours a repair pick (an open PR labelled `land-failed`) may wait under
     *  a hold before the run fails once, for the email. */
    repairAgeHours: number;
    /** Open `ready-to-land` PRs at or past which no NEW pick is dispatched
     *  (issue #6988, `queueAdmission`). */
    queueMax: number;
    /** Open `land-failed` PRs at or past which only repairs are dispatched
     *  (issue #6988, `queueAdmission`). */
    failedMax: number;
}

export const DEFAULT_REPAIR_AGE_HOURS = 4;
/** Two hours of merges at the measured 2.9/h (2026-10-24 → 10-25, issue
 *  #6988). */
export const DEFAULT_QUEUE_MAX = 6;
export const DEFAULT_FAILED_MAX = 4;

const positive = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

export function parseAfkDispatchConfig(raw: unknown): AfkDispatchConfig {
    const block = (raw as { afkDispatch?: Record<string, unknown> } | null)
        ?.afkDispatch;
    return {
        repairAgeHours: positive(
            block?.repairAgeHours,
            DEFAULT_REPAIR_AGE_HOURS
        ),
        queueMax: positive(block?.queueMax, DEFAULT_QUEUE_MAX),
        failedMax: positive(block?.failedMax, DEFAULT_FAILED_MAX),
    };
}

// ─────────────────────────────────────────────────────────────────────────
// Admission by queue depth (issue #6988)
// ─────────────────────────────────────────────────────────────────────────

/** The merge queue's depth, from the dispatcher's one `gh pr list`. */
export interface QueueDepth {
    /** Open PRs labelled `ready-to-land` (queued, held or waiting) and not
     *  `land-failed`. */
    ready: number;
    /** Open PRs labelled `land-failed` — the failure is the newer fact when a
     *  stale `ready-to-land` stands beside it (`landQueueByBranch`'s rule). */
    failed: number;
}

export function queueDepth(
    rows: readonly { labels?: { name?: unknown }[] }[]
): QueueDepth {
    let ready = 0;
    let failed = 0;
    for (const p of rows) {
        const names = (p.labels ?? []).map((l) => l.name);
        if (names.includes(FAILED_LABEL)) failed++;
        else if (names.includes(READY_LABEL)) ready++;
    }
    return { ready, failed };
}

/**
 * What the queue's depth admits this run. The pipeline produced faster than
 * it merged (2026-10-24 → 10-25: 127 passes, 70 merges), and every PR queued
 * behind the merges was rebased again and again; the depth is the feedback.
 *
 *   * `failed` — `land-failed` PRs number `failedMax` or more: repairs only,
 *     no resume, no fresh pick;
 *   * `queue` — `ready-to-land` PRs number `queueMax` or more: no fresh pick;
 *     a resume (a dead pass's claim, work already started) and a repair (it
 *     shrinks the queue) still run;
 *   * `open` — picks as before.
 *
 * Not a `Hold`: a hold stops repairs too, and this is the normal regulator,
 * not an incident — it notifies nobody and lifts on the first run that reads
 * a smaller count.
 */
export type Admission =
    | { kind: "open" }
    | { kind: "queue" | "failed"; message: string };

export const OPEN_ADMISSION: Admission = { kind: "open" };

export function queueAdmission(
    depth: QueueDepth,
    config: Pick<AfkDispatchConfig, "queueMax" | "failedMax">
): Admission {
    if (depth.failed >= config.failedMax)
        return {
            kind: "failed",
            message: `land-failed ${depth.failed} ≥ ${config.failedMax} — repairs only`,
        };
    if (depth.ready >= config.queueMax)
        return {
            kind: "queue",
            message: `queue ${depth.ready} ≥ ${config.queueMax} — no new pick`,
        };
    return OPEN_ADMISSION;
}

/** An open `land-failed` PR and when it was labelled so. */
export interface RepairPick {
    pr: number;
    /** The newest `land-failed` label event; `null` when unreadable. */
    failedAt: string | null;
    /** The PR's creation — the age's floor when `failedAt` is unknown (it
     *  over-states the wait: the email errs toward sent). */
    createdAt: string;
}

export interface AgedRepair {
    pr: number;
    ageHours: number;
    /** When this pick crossed the threshold. */
    agedAtMs: number;
}

export interface AgedRepairNotice {
    /** Repair picks past the threshold, oldest first. */
    aged: AgedRepair[];
    /** THIS run fails, so GitHub sends the one email for the condition. */
    notify: boolean;
}

/**
 * The aged-repair condition: while the dispatcher holds (the kill switch
 * aside — the owner stopped it on purpose), at least one repair pick has
 * waited longer than `repairAgeHours`. Nothing repairs it: the hold keeps
 * every pass from starting, and a hold exits 0, so without this the work
 * waits in silence (2026-10-18: six PRs, 3–20 h, under `no-pass-workflow`).
 *
 * Once per condition, the failure streak's rule: the condition holds since
 * the earliest moment one of the CURRENT aged picks crossed the threshold;
 * a dispatcher run that FAILED (completed) since then is the email. Once
 * every aged pick is repaired the condition clears, and the next pick to age
 * crosses after that failure — a new condition, a new email.
 */
export function agedRepairNotice(
    hold: Hold | null,
    repairs: readonly RepairPick[],
    dispatchRuns: readonly WorkflowRun[],
    config: AfkDispatchConfig,
    nowMs: number
): AgedRepairNotice {
    if (hold === null || hold.kind === "disabled")
        return { aged: [], notify: false };
    const thresholdMs = config.repairAgeHours * 3_600_000;
    const aged: AgedRepair[] = [];
    for (const r of repairs) {
        const since =
            r.failedAt !== null && Number.isFinite(ms(r.failedAt))
                ? ms(r.failedAt)
                : ms(r.createdAt);
        if (!Number.isFinite(since) || nowMs - since <= thresholdMs) continue;
        aged.push({
            pr: r.pr,
            ageHours: (nowMs - since) / 3_600_000,
            agedAtMs: since + thresholdMs,
        });
    }
    aged.sort((a, b) => a.agedAtMs - b.agedAtMs);
    if (aged.length === 0) return { aged, notify: false };
    const reachedMs = aged[0].agedAtMs;
    const notified = dispatchRuns.some(
        (r) => r.conclusion === "failure" && ms(r.updatedAt) >= reachedMs
    );
    return { aged, notify: !notified };
}

/** One line per aged pick, for the job summary: PR, age, the hold. */
export function agedRepairLines(
    aged: readonly AgedRepair[],
    hold: Hold
): string[] {
    return aged.map(
        (a) =>
            `PR #${a.pr} \`${FAILED_LABEL}\` for ${a.ageHours.toFixed(1)} h, unrepaired under hold \`${hold.kind}\``
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Claims
// ─────────────────────────────────────────────────────────────────────────

export interface OpenPr {
    number: number;
    headRefName: string;
    labels: string[];
}

export const ISSUE_BRANCH = /^(?:feat|fix)\/issue-(\d+)$/;

/** Clock slack between a claim's label event and the run it dispatched. */
export const CLAIM_RUN_SLACK_MS = 2 * 60_000;

/**
 * What the `afk-pass` runs say about one claim (`ClaimFacts.run` in
 * `lib/claim-verdict.ts`, whose `classifyClaim` is the ONE verdict, issue #6223):
 *
 *   * `active` — a run for the issue is queued or running;
 *   * `ended`  — a run for it was created AFTER the claim was taken
 *     (`claimedAt`, the newest `in-progress` label event, less a clock
 *     slack), and none is active: the pipeline's own pass died;
 *   * `none`   — no run created after the claim: a session outside the
 *     pipeline (an owner's `/next-ticket`, the old loop), or the dispatcher's
 *     own claim whose run is not listed yet. An older run of the same issue
 *     proves nothing about a newer claim;
 *   * `unknown` — runs of the issue exist but the claim time is unknown, so
 *     none can be attributed to it (fail closed — it releases nothing). No
 *     run at all is `none` whatever the claim time: nothing to attribute.
 */
export function passRunEvidence(
    issue: number,
    passRuns: readonly WorkflowRun[],
    claimedAt: string | null
): PassRunState {
    const mine = passRuns.filter((r) => passRunIssue(r.title) === issue);
    if (mine.some(isActive)) return "active";
    if (mine.length === 0) return "none";
    const at = claimedAt === null ? NaN : ms(claimedAt);
    if (!Number.isFinite(at)) return "unknown";
    return mine.some((r) => ms(r.createdAt) >= at - CLAIM_RUN_SLACK_MS)
        ? "ended"
        : "none";
}

/**
 * The orphan claims to release while the dispatcher holds (issue #6194): a
 * dead pass's claim with no pushed branch and no PR. Releasing starts no
 * pass, so every hold but the kill switch (`disabled`: the owner stopped the
 * machine, it touches nothing) still does it; dispatch and resume stay held.
 */
export function holdReleases(
    hold: Hold,
    claims: readonly JudgedClaim[]
): number[] {
    if (hold.kind === "disabled") return [];
    return claims.filter((c) => claimFate(c) === "release").map((c) => c.issue);
}

/** The newest completed pass run of each issue — whose runner names the host
 *  a resume is pinned to. */
/**
 * A repair already tried (issue #6795): a pass for the issue FINISHED after
 * its PR was last labelled `land-failed`, and the label still stands — that
 * pass could not repair it, and dispatching it again on every dispatcher run
 * would only spend a slot each time. A fresh `land-failed` label (a new red
 * landing) makes it a pick again. An unknown label time never blocks.
 */
export function repairAttempted(
    passRuns: readonly WorkflowRun[],
    issue: number,
    failedAt: string | null
): boolean {
    if (failedAt === null) return false;
    const last = lastPassRun(passRuns, issue);
    return last !== null && ms(last.createdAt) > ms(failedAt);
}

export function lastPassRun(
    passRuns: readonly WorkflowRun[],
    issue: number
): WorkflowRun | null {
    let best: WorkflowRun | null = null;
    for (const r of passRuns) {
        if (passRunIssue(r.title) !== issue || isActive(r)) continue;
        if (best === null || ms(r.createdAt) > ms(best.createdAt)) best = r;
    }
    return best;
}

/**
 * The second barrier behind the concurrency group: the claim is taken only
 * if the issue, read again just before, is still unclaimed and still queued.
 * One run at a time makes a race impossible; this keeps a claim made by
 * anything else (a session, the old loop) from being taken twice.
 */
export function mayClaim(labelsNow: readonly string[]): boolean {
    return (
        !labelsNow.includes(CLAIM_LABEL) &&
        labelsNow.includes("ready-for-agent")
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Runner slots and the dispatch plan
// ─────────────────────────────────────────────────────────────────────────

export interface RunnerRow {
    name: string;
    /** `online` / `offline`. */
    status: string;
    busy: boolean;
    labels: string[];
}

export const PASS_LABEL = "pass";

/** A runner's host, from its `host:<name>` label. */
export function runnerHost(r: RunnerRow): string | null {
    const l = r.labels.find((x) => x.startsWith("host:"));
    return l ? l.slice("host:".length) : null;
}

export interface Slots {
    /** One entry per free `pass` slot: the host that offers it. */
    free: string[];
    /** Hosts with at least one ONLINE `pass` runner, busy or not. */
    online: string[];
}

/**
 * The free `pass` slots: every online, idle `pass` runner, plus this
 * dispatcher's own runner when it is a `pass` one (it frees within seconds),
 * minus the `afk-pass` runs already waiting for a runner — each will take one
 * of these slots, on a host nobody can predict, so the LAST slots go.
 */
export function passSlots(
    runners: readonly RunnerRow[],
    selfName: string | null,
    passRuns: readonly WorkflowRun[]
): Slots {
    const pass = runners.filter(
        (r) => r.labels.includes(PASS_LABEL) && r.status === "online"
    );
    const free: string[] = [];
    for (const r of pass) {
        const host = runnerHost(r);
        if (host === null) continue;
        if (!r.busy || r.name === selfName) free.push(host);
    }
    const waiting = passRuns.filter(isWaiting).length;
    return {
        free: free.slice(0, Math.max(0, free.length - waiting)),
        online: [
            ...new Set(pass.map(runnerHost).filter((h) => h !== null)),
        ] as string[],
    };
}

export interface Dispatch {
    issue: number;
    model: string;
    resume: boolean;
    /** The host a resume is pinned to; `null` = any `pass` runner. */
    host: string | null;
    /** A resume's open PR, when it has one. */
    pr: number | null;
}

export interface DispatchPlan {
    dispatch: Dispatch[];
    /** Orphan claims to release. */
    release: number[];
    /** Resume picks left for a later run (their host's runners are busy). */
    waiting: number[];
    /** Resumes and fresh picks the queue's depth did not admit
     *  (`queueAdmission`); a later run reads the depth again. */
    held: number[];
}

/**
 * The dispatches for this run. Dead passes' work first, in the picker's band
 * order: pinned to the host of their last run while that host is online and
 * has a free slot (its worktree may hold unpushed work), unpinned when the
 * host is offline (the branch is pushed). Then the `land-failed` repairs
 * (issue #6795), oldest PR first, on any host: a repaired PR's pass ENDED,
 * so its claim reads `pr-open` and the picker never offers it again — nothing
 * but this slot repairs it. Then the picker's batch, one slot each. Never more
 * dispatches than free slots. The queue's depth (`queueAdmission`) drops the
 * batch, and under `failed` the resumes too, into `held`.
 */
export function planDispatch(
    picked: PickResult,
    slots: Slots,
    hostOf: (issue: number) => string | null,
    /** `repairItems`' picks: the caller has already left out an issue a live
     *  pass holds, a closed one and an HITL one. */
    repairs: readonly RepairItem[] = [],
    admission: Admission = OPEN_ADMISSION
): DispatchPlan {
    const free = [...slots.free];
    const take = (host: string | null): boolean => {
        const i = host === null ? 0 : free.indexOf(host);
        if (i === -1 || free.length === 0) return false;
        free.splice(i, 1);
        return true;
    };
    const dispatch: Dispatch[] = [];
    const waiting: number[] = [];
    const held: number[] = [];
    for (const r of picked.resume) {
        if (admission.kind === "failed") {
            held.push(r.number);
            continue;
        }
        const last = hostOf(r.number);
        const host = last !== null && slots.online.includes(last) ? last : null;
        if (take(host))
            dispatch.push({
                issue: r.number,
                model: r.model,
                resume: true,
                host,
                pr: r.pr,
            });
        else waiting.push(r.number);
    }
    // One pass per issue: a resume wins, and two `land-failed` PRs naming one
    // issue repair it once. A resume the depth held is no pass: its
    // `land-failed` PR is still repaired here.
    const seen = new Set(
        picked.resume.map((r) => r.number).filter((n) => !held.includes(n))
    );
    for (const r of repairs) {
        if (seen.has(r.number)) continue;
        if (!take(null)) break;
        seen.add(r.number);
        dispatch.push({
            issue: r.number,
            model: r.model,
            resume: true,
            host: null,
            pr: r.pr,
        });
    }
    for (const p of picked.plan.batch) {
        if (admission.kind !== "open") {
            held.push(p.number);
            continue;
        }
        if (!take(null)) break;
        dispatch.push({
            issue: p.number,
            model: p.model,
            resume: false,
            host: null,
            pr: null,
        });
    }
    const dispatched = new Set(dispatch.map((d) => d.issue));
    return {
        dispatch,
        release: [...picked.release],
        waiting,
        held: held.filter((n) => !dispatched.has(n)),
    };
}

/**
 * Whether a hold still lets REPAIR passes start (issue #6652). Only `red`: a
 * repair works on its own PR's branch and never the base, so ADR 0116's "no
 * work on a broken tip" does not forbid it, and a `land-failed` PR under a RED
 * is one `pr-gate` proved red on files the RED does not fail. Every other
 * hold stands for a reason a repair shares (an unknown base, the budget, the
 * kill switch).
 */
export function holdAdmitsRepairs(
    hold: Hold,
    /** `holdFor` over the same input with the RED removed: a RED that is the
     *  ONLY hold. The budget, usage limit and unreadable records stand under
     *  a RED too, and a repair pass spends tokens like any other. */
    holdWithoutRed: Hold | null
): boolean {
    return hold.kind === "red" && holdWithoutRed === null;
}

/** A picker result with nothing in it: a hold that admits repairs plans no
 *  resume and no new issue. */
const NO_PICK: PickResult = {
    plan: {
        version: 1,
        batch: [],
        deferred: [],
        skipped: [],
        staleClaims: [],
        activeClaims: [],
    },
    resume: [],
    release: [],
    live: [],
    untrusted: [],
};

/** The dispatches under a hold that admits repairs: the `land-failed`
 *  repairs, one slot each, and never a new issue or a resume. */
export function planRepairsUnderHold(
    slots: Slots,
    repairs: readonly RepairItem[]
): DispatchPlan {
    return planDispatch(NO_PICK, slots, () => null, repairs);
}

/** `TRUSTED_AUTHORS` — logins separated by commas, spaces or new lines. */
export function parseTrustedAuthors(raw: string | undefined): string[] {
    return (raw ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^@/, ""))
        .filter((s) => s.length > 0);
}

/** The host a runner name belongs to: `<host>-<role>-<n>` (`github-runner`). */
export function hostOfRunnerName(name: string): string | null {
    const m = /^(.+)-(?:pass|lane|seed)-\d+$/.exec(name);
    return m ? m[1] : null;
}
