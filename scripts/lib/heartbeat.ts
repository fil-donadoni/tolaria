/**
 * The heartbeat — the pipeline's fallback clock (issue #7445, ADR 0156
 * Amendment IV). GitHub drops most `schedule` runs (measured: `afk-dispatch`
 * at `*\/30` fired 3–6 times a day, `health` at `50 *\/2` 3–5), so a
 * machine timer beside the runners (`scripts/runner-units/`, installed by
 * `bun run runner install`) asks every ten minutes whether either clock has
 * gone quiet, and dispatches the workflow itself when it has:
 *
 *  - `afk-dispatch.yml` when its newest run, of ANY event, is older than
 *    `AFK_DISPATCH_STALE_MS` and none is queued or running;
 *  - `health.yml` (`job=gate`) when the base tip has no verdict, no health
 *    run is queued, running or on the pivot, and the newest `health.yml` run
 *    is older than `HEALTH_GATE_STALE_MS`.
 *
 * Both machines run it: the facts are re-read on every tick, right before the
 * dispatch, and each workflow's concurrency group serialises a double fire —
 * the heartbeat only has to be idempotent, never elected. A disabled workflow
 * (the kill switch) is never dispatched. Every unreadable fact answers "do
 * not fire": the next tick is ten minutes away.
 *
 * A third, read-only check flags a queue that stalls silently (issue #9065):
 * a `startup_failure` of `pr-gate` / `owner-merge` (a `pull_request_target`
 * brownout) or a `ready-to-land` PR / queue
 * draft whose head has had no `trusted-author` status for
 * `TRUSTED_AUTHOR_MISSING_MS` — the `staging` ruleset requires that status, so
 * each draft waits and nothing turns red. It dispatches nothing; a flag makes
 * the tick exit 1 and shows in `runner status`.
 *
 * The decisions are pure (`clockDue`, `healthGateDue`, `queueGateFlags`);
 * `tick` reads and acts
 * through injected effects; the last tick is written to `HEARTBEAT_STATE` so
 * `bun run runner status` shows a dead heartbeat.
 */
import { homedir } from "node:os";
import { join } from "node:path";

/** The unit's period: launchd `StartInterval`, the systemd timer's
 *  `OnUnitActiveSec` (both read 600 s). */
export const HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

/** A heartbeat whose last tick is older than this is dead (three periods). */
export const HEARTBEAT_DEAD_MS = 3 * HEARTBEAT_INTERVAL_MS;

/** `afk-dispatch.yml`'s cron period: the dispatcher is owed a run when its
 *  newest one is older. */
export const AFK_DISPATCH_STALE_MS = 30 * 60 * 1000;

/** `health.yml`'s cron period: the gate is owed when the tip has had no
 *  verdict and no run this long. */
export const HEALTH_GATE_STALE_MS = 2 * 60 * 60 * 1000;

/** A `ready-to-land` PR or queue draft with no `trusted-author` status on its
 *  head this long is stalled: pr-gate's `*\/15` sweep plus slack. */
export const TRUSTED_AUTHOR_MISSING_MS = 20 * 60 * 1000;

/** A `startup_failure` this recent, with no later success, is flagged. */
export const STARTUP_FAILURE_WINDOW_MS = 3 * 60 * 60 * 1000;

/** The workflows whose failure to start stalls the queue. */
export const QUEUE_GATE_WORKFLOWS = ["pr-gate.yml", "owner-merge.yml"] as const;

export const HEARTBEAT_STATE = join(
    homedir(),
    ".cache/tolaria/heartbeat/last.json"
);

/** A run that has not settled: the clock is ticking, nothing to add. */
const UNSETTLED = new Set([
    "queued",
    "in_progress",
    "waiting",
    "pending",
    "requested",
]);

/** A run that never ran its job: a label event the job's `if` skips (the
 *  dispatcher's own `in-progress` claims), a pending run a newer one
 *  displaced. It proves nothing about the clock. */
const NOT_A_TICK = new Set(["skipped", "cancelled"]);

/** One workflow run, as `gh run list --json createdAt,status,conclusion`
 *  reads it. */
export interface RunFact {
    createdAt: string;
    status: string;
    conclusion?: string | null;
    /** The run's page, named in a startup-failure flag. */
    url?: string;
}

/** A health verdict that settles the tip: GREEN or RED. An INFRA is
 *  re-gated (`--retry-infra`) and an AMBER is a run in flight or dead, so
 *  neither stops the heartbeat. Pure. */
export function settlesTip(status: string | null | undefined): boolean {
    return status === "green" || status === "red";
}

/** What a clock knows about its workflow. */
export interface WorkflowClock {
    /** The workflow is enabled (`state: active`); false = the kill switch. */
    active: boolean;
    /** Its newest runs, any event, any order. */
    runs: readonly RunFact[];
}

export interface ClockDecision {
    fire: boolean;
    reason: string;
}

function ago(ms: number): string {
    const m = Math.round(ms / 60_000);
    return m < 120 ? `${m} min ago` : `${(m / 60).toFixed(1)} h ago`;
}

/**
 * The staleness rule, pure: fire when the workflow is enabled, no run is
 * queued or running, and its newest run is older than `staleMs` (or it has
 * none at all).
 */
export function clockDue(
    clock: WorkflowClock,
    now: number,
    staleMs: number
): ClockDecision {
    if (!clock.active)
        return { fire: false, reason: "workflow disabled (kill switch)" };
    if (clock.runs.some((r) => UNSETTLED.has(r.status)))
        return { fire: false, reason: "a run is queued or running" };
    const newest = Math.max(
        ...clock.runs
            .filter((r) => !NOT_A_TICK.has(r.conclusion ?? ""))
            .map((r) => Date.parse(r.createdAt))
            .filter(Number.isFinite)
    );
    if (!Number.isFinite(newest))
        return { fire: true, reason: "no run on record" };
    const age = now - newest;
    return age >= staleMs
        ? { fire: true, reason: `last run ${ago(age)} — stale` }
        : { fire: false, reason: `last run ${ago(age)}` };
}

/** What the health clock knows beyond its workflow's runs. */
export interface HealthFacts extends WorkflowClock {
    /** The base tip's short sha, for the reason line. */
    tip: string;
    /** The base tip carries a settling verdict (`settlesTip`). */
    tipHasVerdict: boolean;
    /** A health run holds the pivot (any machine). */
    pivotInFlight: boolean;
}

/** The health gate's rule, pure: the tip has no verdict, nothing is in
 *  flight, and the workflow's clock is stale. */
export function healthGateDue(
    facts: HealthFacts,
    now: number,
    staleMs: number = HEALTH_GATE_STALE_MS
): ClockDecision {
    if (facts.tipHasVerdict)
        return { fire: false, reason: `tip ${facts.tip} has a verdict` };
    if (facts.pivotInFlight)
        return { fire: false, reason: "a health run holds the pivot" };
    const clock = clockDue(facts, now, staleMs);
    return {
        fire: clock.fire,
        reason: `tip ${facts.tip} has no verdict; ${clock.reason}`,
    };
}

/** A workflow's newest runs, for the startup-failure check. */
export interface GateWorkflowRuns {
    workflow: string;
    runs: readonly RunFact[];
}

/** A PR the queue is waiting on: `ready-to-land`, or a Mergify draft. */
export interface QueuedPrFact {
    number: number;
    /** The head sha's short form, for the flag line. */
    sha: string;
    /** The head carries a `trusted-author` status, in any state. */
    hasTrustedAuthor: boolean;
    /** When the PR last changed (`updatedAt`): a push or label restarts the
     *  wait, so the check can only err quiet. */
    updatedAt: string;
}

export interface QueueGateFacts {
    workflows: readonly GateWorkflowRuns[];
    prs: readonly QueuedPrFact[];
}

/**
 * The silent-stall rule, pure (issue #9065): one line per problem, empty on a
 * healthy queue.
 *
 *  - a workflow's newest `startup_failure` inside `STARTUP_FAILURE_WINDOW_MS`
 *    is flagged unless a later run succeeded (the brownout is over);
 *  - a queued PR with no `trusted-author` on its head, unchanged for
 *    `TRUSTED_AUTHOR_MISSING_MS`, is flagged by number.
 */
export function queueGateFlags(
    facts: QueueGateFacts,
    now: number,
    missingMs: number = TRUSTED_AUTHOR_MISSING_MS
): string[] {
    const flags: string[] = [];
    for (const { workflow, runs } of facts.workflows) {
        const at = (r: RunFact) => Date.parse(r.createdAt);
        const failed = runs
            .filter((r) => r.conclusion === "startup_failure")
            .filter((r) => now - at(r) < STARTUP_FAILURE_WINDOW_MS)
            .sort((a, b) => at(b) - at(a))[0];
        if (!failed) continue;
        if (runs.some((r) => r.conclusion === "success" && at(r) > at(failed)))
            continue;
        flags.push(
            `${workflow} startup_failure ${ago(now - at(failed))}${failed.url ? ` — ${failed.url}` : ""}`
        );
    }
    for (const pr of facts.prs) {
        if (pr.hasTrustedAuthor) continue;
        const age = now - Date.parse(pr.updatedAt);
        if (age >= missingMs)
            flags.push(
                `PR #${pr.number} (${pr.sha}) has no trusted-author status for ${ago(age)}`
            );
    }
    return flags;
}

/** One clock's outcome in a tick. */
export interface ClockOutcome extends ClockDecision {
    /** The dispatch ran and `gh` accepted it. */
    dispatched?: boolean;
    /** The read or the dispatch failed. */
    error?: string;
}

/** The queue-gate check's outcome: what to look at, or why it could not read. */
export interface QueueGateOutcome {
    flags: string[];
    error?: string;
}

/** The last tick, as `HEARTBEAT_STATE` holds it. */
export interface HeartbeatState {
    at: string;
    host: string;
    afkDispatch: ClockOutcome;
    health: ClockOutcome;
    /** Absent in a state file written before issue #9065. */
    queueGate?: QueueGateOutcome;
}

/** The effects a tick needs — `scripts/heartbeat.ts` wires them to `gh`. */
export interface HeartbeatDeps {
    afkDispatchClock(): WorkflowClock;
    healthFacts(): HealthFacts;
    queueGateFacts(): QueueGateFacts;
    dispatchAfk(): void;
    dispatchHealthGate(): void;
    now(): number;
    host: string;
    dryRun?: boolean;
}

function settle(
    decide: () => ClockDecision,
    dispatch: () => void,
    dryRun: boolean
): ClockOutcome {
    let decision: ClockDecision;
    try {
        decision = decide();
    } catch (e) {
        return {
            fire: false,
            reason: "facts unreadable — next tick",
            error: (e as Error).message.split("\n")[0],
        };
    }
    if (!decision.fire || dryRun) return decision;
    try {
        dispatch();
        return { ...decision, dispatched: true };
    } catch (e) {
        return {
            ...decision,
            dispatched: false,
            error: (e as Error).message.split("\n")[0],
        };
    }
}

function readQueueGate(deps: HeartbeatDeps): QueueGateOutcome {
    try {
        return { flags: queueGateFlags(deps.queueGateFacts(), deps.now()) };
    } catch (e) {
        return { flags: [], error: (e as Error).message.split("\n")[0] };
    }
}

/** One heartbeat: read both clocks, dispatch the stale ones. Total. */
export function tick(deps: HeartbeatDeps): HeartbeatState {
    const dryRun = deps.dryRun ?? false;
    return {
        at: new Date(deps.now()).toISOString(),
        host: deps.host,
        afkDispatch: settle(
            () =>
                clockDue(
                    deps.afkDispatchClock(),
                    deps.now(),
                    AFK_DISPATCH_STALE_MS
                ),
            deps.dispatchAfk,
            dryRun
        ),
        health: settle(
            () => healthGateDue(deps.healthFacts(), deps.now()),
            deps.dispatchHealthGate,
            dryRun
        ),
        queueGate: readQueueGate(deps),
    };
}

function outcomeLine(o: ClockOutcome): string {
    const act =
        o.dispatched === true
            ? "DISPATCHED"
            : o.dispatched === false
              ? "dispatch FAILED"
              : o.fire
                ? "due (dry run)"
                : "quiet";
    return `${act} — ${o.reason}${o.error ? ` (${o.error})` : ""}`;
}

function queueGateLines(g: QueueGateOutcome | undefined): string[] {
    if (!g) return [];
    const lines = g.flags.map((f) => `    queue gate     FLAGGED — ${f}`);
    if (g.error) lines.push(`    queue gate     unreadable (${g.error})`);
    return lines.length ? lines : ["    queue gate     quiet"];
}

/** The lines `machine` and `runner status` print: the last tick, flagged
 *  DEAD past `HEARTBEAT_DEAD_MS`. Pure. */
export function heartbeatLines(text: string | null, now: number): string[] {
    if (text === null)
        return [
            "  heartbeat        never fired — `bun run runner install` installs it",
        ];
    let s: HeartbeatState;
    try {
        s = JSON.parse(text) as HeartbeatState;
    } catch {
        return ["  heartbeat        state unreadable"];
    }
    const age = now - Date.parse(s.at);
    const dead = !Number.isFinite(age) || age >= HEARTBEAT_DEAD_MS;
    return [
        `  heartbeat        last fire ${Number.isFinite(age) ? ago(age) : s.at}${dead ? " — DEAD (the fallback clock is stopped)" : ""}`,
        `    afk-dispatch   ${outcomeLine(s.afkDispatch)}`,
        `    health gate    ${outcomeLine(s.health)}`,
        ...queueGateLines(s.queueGate),
    ];
}
