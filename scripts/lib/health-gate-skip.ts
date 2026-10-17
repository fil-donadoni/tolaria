/**
 * Whether `health-main` must gate a tip now: the part of its `last.json` the
 * decision reads, and the pure rule over it (issue #4960).
 */
import type { HealthStatus } from "./health-verdict";
import type { Verdict } from "./health-verdict-store";

/** A `running` record older than this belongs to a run that died. */
const IN_FLIGHT_STALE_MS = 90 * 60 * 1000;

function short(sha: string): string {
    return sha.slice(0, 8);
}

/** The part of `health-main.ts`'s `last.json` this module reasons about. */
export interface HealthRecord {
    sha: string;
    status: HealthStatus;
    /** ISO, as `health-main.ts` writes it. */
    startedAt: string;
    failedStep?: string;
    /** `infra` only: why, and what to do (`INFRA_REMEDY`, issue #4943). */
    reason?: string;
    /** ISO: when the run's current PHASE began — the browser walk, after the
     *  offline gates released the mutex (issue #4962). Liveness reads it. */
    phaseStartedAt?: string;
    /** `running` only: `walk` once the offline gates passed (issue #4962). */
    phase?: "walk";
    /** The browser walk's state; `pending` = owed, nobody walking yet. */
    ui?: string;
}

/**
 * Is a health run already in flight? A `running` record younger than `staleMs`
 * is a live run; older belongs to one that died. Its age counts from the
 * current PHASE (`phaseStartedAt`, issue #4962) when there is one: offline
 * gates plus the browser walk can outlast `staleMs` together while each phase
 * stays well inside it. `staleMs` mirrors `health-main.ts`'s own
 * `STALE_RUNNING_MS`.
 */
export function healthRunInFlight(
    last: HealthRecord | null,
    now: number,
    staleMs: number = IN_FLIGHT_STALE_MS
): string | null {
    if (last === null || last.status !== "running") return null;
    const startedAt = Date.parse(last.phaseStartedAt ?? last.startedAt);
    if (!Number.isFinite(startedAt) || now - startedAt >= staleMs) return null;
    return `a health run on ${short(last.sha)} is already in flight`;
}

/**
 * Why `health-main` must NOT gate `tip` now, or null to gate it.
 *
 * A tip already green, or being gated by a live run, is never re-gated. A
 * tip with a RED or INFRA verdict is re-gated only on an explicit decision
 * (`retryTerminal`: `bun run health` by hand, or a job run on `--retry-infra`).
 * A tip that moved since the verdict is a different sha, and is gated.
 */
export function gateSkipReason(input: {
    last: HealthRecord | null;
    tip: string;
    now: number;
    retryTerminal: boolean;
    staleMs?: number;
    /** The verdict the shared store holds for `tip` (issue #5593): a GREEN
     *  another machine proved is as final as a local one. */
    stored?: Verdict | null;
}): string | null {
    const { last, tip, now, retryTerminal } = input;
    if (input.stored?.sha === tip && input.stored.status === "green")
        return `tip ${short(tip)} already green on the verdict store${input.stored.machine ? ` (${input.stored.machine})` : ""}`;
    if (last === null || last.sha !== tip) return null;
    if (last.status === "green") return `tip ${short(tip)} already green`;
    if (last.status === "running")
        return healthRunInFlight(last, now, input.staleMs) === null
            ? null
            : `tip ${short(tip)} already being gated`;
    if (retryTerminal) return null;
    return `tip ${short(tip)} already has a ${last.status.toUpperCase()} verdict${last.failedStep ? ` (${last.failedStep})` : ""} — a job never re-gates it; \`bun run health\` retries by hand`;
}
