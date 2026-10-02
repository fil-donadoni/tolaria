/**
 * The per-batch health CADENCE decision (ADR 0136 §6, issue #3780), as pure
 * functions over hand-buildable inputs.
 *
 * `land` pays the LANE gate and nothing else. The FULL gate — `health-main.ts`
 * — used to run once per release (ADR 0116), which left a red base tip
 * standing for the 1–2 days observed between releases while every new worktree
 * branched from it. It now runs per BATCH of landings: after the 5th landing
 * since the last GREEN, or 2 h after the first un-healthed one, whichever
 * comes first.
 *
 * This module owns the decision; `scripts/health-cadence.ts` owns the side
 * effects (the ledger file, the fetch, the detached gate). The scenarios the
 * rules exist to satisfy are A/B/C in `docs/guides/next-issue-flow.md` § 2.
 *
 * Node builtins only — nothing here imports anything at runtime (one
 * erased type import), so `land`'s locked command can reach the CLI around it
 * without dragging a module graph into a shell step that must never fail.
 */
import type { HealthStatus } from "./health-verdict";

/**
 * How a landing made under a standing RED declared itself (issue #4964).
 * Absent on an ordinary landing.
 *
 *  - `repair` — the PR closes the issue a `/health-fix` session opened (see
 *    `repairIssues`), or `land --repair` declared it: the landing that can
 *    turn the tip GREEN, so it is gated at once.
 *  - `red-ok` — unrelated work landed on a red tip by `land --red-ok`: a
 *    stated act, counted, and never on its own a reason to re-gate.
 */
export type LandingKind = "repair" | "red-ok";

/** One landing on the base branch: the tip it created, and when it merged. */
export interface Landing {
    /** The base-branch tip the squash produced — what a health run would gate. */
    sha: string;
    /** Epoch ms, from the `land` that merged it. */
    at: number;
    kind?: LandingKind;
}

/** The last trigger decision, kept so `health:status` can say why the last
 *  landing did or did not fire (issue #4964). */
export interface CadenceDecision {
    /** Epoch ms of the decision. */
    at: number;
    /** The base tip the decision was about. */
    tip: string;
    kind: "fire" | "hold";
    reason: string;
}

/**
 * The durable ledger, `.claude/telemetry/health/cadence.json` in the primary
 * checkout.
 *
 * `landings` holds only the UN-HEALTHED ones: a GREEN run prunes everything it
 * covered (see `afterGreen`), so `landings.length` IS the count the trigger
 * reads and `landings[0].at` IS the age of the batch.
 */
export interface CadenceState {
    landings: Landing[];
    /** The sha the last GREEN health run gated, or null before the first one. */
    lastGreenSha: string | null;
    /** The sha health was last STARTED for — the dedup key (ADR 0136 §6). */
    lastFiredSha: string | null;
    /** When that fire happened. The dedup EXPIRES: a run that never wrote a
     *  verdict — a reboot, a `gate:who` reclaim, a machine asleep — would
     *  otherwise wedge that tip's batch for ever, which is precisely the
     *  exposure §6 bounds at "≤ 5 landings or 2 h". */
    lastFiredAt: number | null;
    /**
     * The `detach` process that fired and has not yet reconciled — QUEUED on
     * the mutex or running the gate. `last.json` only says `running` once
     * `health-main` holds the mutex, so without this a fire waiting behind
     * queued lands is invisible and every landing meanwhile queues another
     * waiter for the same tip (issue #4960, issue #4964). Cleared by the
     * reconcile, whatever its outcome.
     */
    pendingPid: number | null;
    /** When that pending fire started — bounds a pid that outlived its run. */
    pendingSince: number | null;
    /** Issues `/health-fix` opened for the standing RED: a PR closing one is a
     *  `repair` landing. Cleared by GREEN. */
    repairIssues: number[];
    lastDecision: CadenceDecision | null;
}

export const EMPTY_CADENCE: CadenceState = {
    landings: [],
    lastGreenSha: null,
    lastFiredSha: null,
    lastFiredAt: null,
    pendingPid: null,
    pendingSince: null,
    repairIssues: [],
    lastDecision: null,
};

/** Landings since the last GREEN after which the batch gate fires. */
export const LANDINGS_PER_BATCH = 5;
/** Age of the FIRST un-healthed landing after which it fires regardless. */
export const MAX_BATCH_AGE_MS = 2 * 60 * 60 * 1000;
/** How long a fire suppresses another on the same tip. The same 90 minutes
 *  `health-main.ts` gives its own `running` record, and for the same reason:
 *  past it, a run that left no verdict is assumed gone rather than slow. */
export const FIRE_DEDUP_MS = 90 * 60 * 1000;
/** Past this, a pending fire's pid is assumed reused rather than still ours:
 *  a full gate after a bounded `yield` wait never takes this long. */
export const MAX_PENDING_MS = 6 * 60 * 60 * 1000;

export type CadenceVerdict =
    | {
          kind: "fire";
          /** Which threshold tripped — the reason a reader wants. `repair`
           *  only under RED: a declared repair landed since the last fire. */
          trigger: "count" | "age" | "repair";
          /** The tip to gate: the one CURRENT now, not the one that triggered. */
          sha: string;
          reason: string;
      }
    | { kind: "hold"; reason: string };

export interface TriggerInput {
    state: CadenceState;
    /** The base-branch tip as it is NOW — health gates this, per ADR 0136 §6. */
    tip: string;
    now: number;
    /** The durable RED marker stands — see `redTrigger`. */
    red?: boolean;
    /** Why a health run is already queued or running (`pendingHealthRun`),
     *  or null/absent when none is. */
    pending?: string | null;
    landingsPerBatch?: number;
    maxAgeMs?: number;
    fireDedupMs?: number;
}

function short(sha: string): string {
    return sha.slice(0, 8);
}

function minutes(ms: number): string {
    return `${Math.round(ms / 60_000)}m`;
}

/**
 * Whether the batch gate fires for `tip`, and why.
 *
 * Order is deliberate. The two DEDUP checks come before the two thresholds,
 * because a tip that is already green, or already being gated, must not be
 * re-gated however many landings are behind it — that is what keeps the
 * "5 quick landings" case one health run rather than five (ADR 0116's own
 * measurement: 213 mutex-minutes a day, 19% of them RED from contention).
 *
 * `count` is checked before `age` so a full batch reports the threshold it
 * actually reached; a batch that is both full and old is a `count`.
 *
 * A run already queued or running holds every later decision: it re-resolves
 * the tip when it takes the mutex, so a queued one already covers the new
 * landing, and a running one is followed by a re-decision in the `detach`
 * that owns it (issue #4964).
 *
 * Under RED the thresholds count from the last FIRE, not the last GREEN —
 * `redTrigger`. Counting from GREEN fired one full gate per landing for as
 * long as the base stayed red: 22 runs in ~43 h, 2026-09-30 → 2026-10-02.
 */
export function healthTrigger(input: TriggerInput): CadenceVerdict {
    const {
        state,
        tip,
        now,
        landingsPerBatch = LANDINGS_PER_BATCH,
        maxAgeMs = MAX_BATCH_AGE_MS,
        fireDedupMs = FIRE_DEDUP_MS,
    } = input;

    if (state.landings.length === 0)
        return { kind: "hold", reason: "no landing since the last health run" };
    if (tip === state.lastGreenSha)
        return {
            kind: "hold",
            reason: `tip ${short(tip)} is already GREEN`,
        };
    if (
        tip === state.lastFiredSha &&
        state.lastFiredAt !== null &&
        now - state.lastFiredAt < fireDedupMs
    )
        return {
            kind: "hold",
            reason: `health already started for tip ${short(tip)}`,
        };
    if (input.pending)
        return {
            kind: "hold",
            reason: `${input.pending} — it covers this landing`,
        };
    if (input.red)
        return redTrigger(state, tip, now, landingsPerBatch, maxAgeMs);

    const count = state.landings.length;
    const ageMs = now - state.landings[0].at;

    if (count >= landingsPerBatch)
        return {
            kind: "fire",
            trigger: "count",
            sha: tip,
            reason: `${count} landings since the last GREEN (threshold ${landingsPerBatch})`,
        };
    if (ageMs >= maxAgeMs)
        return {
            kind: "fire",
            trigger: "age",
            sha: tip,
            reason: `the oldest un-healthed landing is ${minutes(ageMs)} old (threshold ${minutes(maxAgeMs)})`,
        };
    return {
        kind: "hold",
        reason: `${count}/${landingsPerBatch} landings, oldest ${minutes(ageMs)} of ${minutes(maxAgeMs)}`,
    };
}

/**
 * The landings no health run has STARTED on yet: those after the sha the last
 * fire gated (`lastFiredSha`, rewritten by the reconcile to the sha the run
 * actually gated). Falls back to the fire's timestamp when that sha is not a
 * recorded landing — a push that bypassed `land`, or one pruned by GREEN.
 */
export function landingsSinceFire(state: CadenceState): Landing[] {
    if (state.lastFiredSha === null) return state.landings;
    const idx = state.landings.findIndex((l) => l.sha === state.lastFiredSha);
    if (idx >= 0) return state.landings.slice(idx + 1);
    const firedAt = state.lastFiredAt;
    if (firedAt === null) return state.landings;
    return state.landings.filter((l) => l.at > firedAt);
}

/**
 * The trigger while the RED marker stands (issue #4964).
 *
 * RED refuses the next PICK, and `land` refuses the next non-repair LAND
 * without `--red-ok`, but the sessions already mid-issue still land — and each
 * of those used to clear the dedup on its new tip and pay a full gate that
 * could only report the same red, or add one of its own. Now:
 *
 *  - a declared `repair` landing since the last fire fires at once — it is the
 *    landing that can turn the tip GREEN, the reason RED never paused the
 *    cadence outright;
 *  - otherwise the batch thresholds apply, counted from the last FIRE: under
 *    RED the base is gated at most once per batch, never once per landing.
 */
function redTrigger(
    state: CadenceState,
    tip: string,
    now: number,
    landingsPerBatch: number,
    maxAgeMs: number
): CadenceVerdict {
    const since = landingsSinceFire(state);
    if (since.length === 0)
        return {
            kind: "hold",
            reason: "RED: no landing since the last health run started",
        };
    const repair = since.find((l) => l.kind === "repair");
    if (repair !== undefined)
        return {
            kind: "fire",
            trigger: "repair",
            sha: tip,
            reason: `RED: ${short(repair.sha)} is a declared repair`,
        };
    const count = since.length;
    const ageMs = now - since[0].at;
    if (count >= landingsPerBatch)
        return {
            kind: "fire",
            trigger: "count",
            sha: tip,
            reason: `RED: ${count} landings since the last fire (threshold ${landingsPerBatch})`,
        };
    if (ageMs >= maxAgeMs)
        return {
            kind: "fire",
            trigger: "age",
            sha: tip,
            reason: `RED: the oldest landing since the last fire is ${minutes(ageMs)} old (threshold ${minutes(maxAgeMs)})`,
        };
    return {
        kind: "hold",
        reason: `RED: ${count}/${landingsPerBatch} landings since the last fire, oldest ${minutes(ageMs)} of ${minutes(maxAgeMs)}, none a declared repair`,
    };
}

/**
 * Record a landing. Idempotent on the tip already at the tail: a `land`
 * retried after a transient merge refusal re-runs its post-merge steps
 * against the SAME base tip (ADR 0136 §2 is the whole reason a retry is
 * cheap), and counting that twice would fire the batch gate a landing early.
 */
export function recordLanding(
    state: CadenceState,
    sha: string,
    at: number,
    kind?: LandingKind
): CadenceState {
    const last = state.landings[state.landings.length - 1];
    if (last?.sha === sha) return state;
    const landing: Landing =
        kind === undefined ? { sha, at } : { sha, at, kind };
    return { ...state, landings: [...state.landings, landing] };
}

/** `/health-fix` opened `issue` for the standing RED: a PR closing it is a
 *  `repair` landing. Idempotent. */
export function recordRepairIssue(
    state: CadenceState,
    issue: number
): CadenceState {
    if (state.repairIssues.includes(issue)) return state;
    return { ...state, repairIssues: [...state.repairIssues, issue] };
}

/** A fire is now queued or running in process `pid` — see `pendingPid`. */
export function withPending(
    state: CadenceState,
    pid: number,
    at: number
): CadenceState {
    return { ...state, pendingPid: pid, pendingSince: at };
}

export function clearPending(state: CadenceState): CadenceState {
    return { ...state, pendingPid: null, pendingSince: null };
}

export function recordDecision(
    state: CadenceState,
    decision: CadenceDecision
): CadenceState {
    return { ...state, lastDecision: decision };
}

/** The `health:status` line for the last decision (issue #4964). */
export function describeLastDecision(state: CadenceState): string {
    const d = state.lastDecision;
    if (d === null) return "no cadence decision recorded yet";
    const last = state.landings[state.landings.length - 1];
    const kind = last?.kind ? ` (${last.kind})` : "";
    const landing =
        last === undefined ? "" : `last landing ${short(last.sha)}${kind}; `;
    return `${landing}${d.kind === "fire" ? "FIRED" : "held"} on tip ${short(d.tip)} at ${new Date(d.at).toISOString()} — ${d.reason}`;
}

/** Health has been started for `sha` — the dedup stamp, written BEFORE the
 *  gate runs so a second detach on the same tip holds even while it runs. It
 *  expires (`FIRE_DEDUP_MS`), so a fire that dies without a verdict costs one
 *  dedup window rather than that batch's whole coverage. */
export function afterFire(
    state: CadenceState,
    sha: string,
    at: number
): CadenceState {
    return { ...state, lastFiredSha: sha, lastFiredAt: at };
}

/**
 * GREEN at `gatedSha` — the counter resets.
 *
 * "Resets" is not "empties": health gates the tip CURRENT at its start, so one
 * run covers every landing up to that tip and NONE of the landings that merged
 * while it ran (scenario B, #6–#11). The gated tip is normally one of the
 * recorded landings, and everything up to and including it is covered; when it
 * is not (a push that did not come through `land`), `startedAt` is the
 * fallback cut — a landing recorded at or after the run began is a descendant
 * of the gated tip and stays un-healthed. The boundary keeps the landing
 * rather than dropping it: an un-healthed landing costs one extra gate, a
 * landing wrongly marked covered costs the coverage this file exists for.
 */
export function afterGreen(
    state: CadenceState,
    gatedSha: string,
    startedAt: number
): CadenceState {
    const idx = state.landings.findIndex((l) => l.sha === gatedSha);
    const landings =
        idx >= 0
            ? state.landings.slice(idx + 1)
            : state.landings.filter((l) => l.at >= startedAt);
    return { ...state, landings, lastGreenSha: gatedSha, repairIssues: [] };
}

/** Fail-soft: an absent, truncated or hand-mangled ledger reads as EMPTY —
 *  the batch gate is a cadence, never a correctness barrier, and a parse
 *  error must not stop `land` writing the next landing. */
export function parseCadence(raw: string | null): CadenceState {
    if (raw === null) return EMPTY_CADENCE;
    let doc: unknown;
    try {
        doc = JSON.parse(raw);
    } catch {
        return EMPTY_CADENCE;
    }
    if (typeof doc !== "object" || doc === null || Array.isArray(doc))
        return EMPTY_CADENCE;
    const record = doc as Record<string, unknown>;
    const landings: Landing[] = Array.isArray(record.landings)
        ? record.landings.flatMap((entry): Landing[] => {
              if (typeof entry !== "object" || entry === null) return [];
              const e = entry as Record<string, unknown>;
              if (typeof e.sha !== "string" || e.sha.length === 0) return [];
              if (typeof e.at !== "number" || !Number.isFinite(e.at)) return [];
              const kind =
                  e.kind === "repair" || e.kind === "red-ok"
                      ? e.kind
                      : undefined;
              return [
                  kind === undefined
                      ? { sha: e.sha, at: e.at }
                      : { sha: e.sha, at: e.at, kind },
              ];
          })
        : [];
    const finite = (v: unknown): number | null =>
        typeof v === "number" && Number.isFinite(v) ? v : null;
    const d = record.lastDecision as Record<string, unknown> | null;
    const lastDecision: CadenceDecision | null =
        typeof d === "object" &&
        d !== null &&
        finite(d.at) !== null &&
        typeof d.tip === "string" &&
        (d.kind === "fire" || d.kind === "hold") &&
        typeof d.reason === "string"
            ? { at: d.at as number, tip: d.tip, kind: d.kind, reason: d.reason }
            : null;
    return {
        landings,
        lastGreenSha:
            typeof record.lastGreenSha === "string"
                ? record.lastGreenSha
                : null,
        lastFiredSha:
            typeof record.lastFiredSha === "string"
                ? record.lastFiredSha
                : null,
        lastFiredAt: finite(record.lastFiredAt),
        pendingPid: finite(record.pendingPid),
        pendingSince: finite(record.pendingSince),
        repairIssues: Array.isArray(record.repairIssues)
            ? record.repairIssues.filter(
                  (n): n is number => Number.isInteger(n) && n > 0
              )
            : [],
        lastDecision,
    };
}

export function serializeCadence(state: CadenceState): string {
    return `${JSON.stringify(state, null, 2)}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciling a finished run with the ledger
// ─────────────────────────────────────────────────────────────────────────────

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
}

export type ReconcileAction =
    | { kind: "green"; state: CadenceState; sha: string; reason: string }
    | { kind: "red"; state: CadenceState; sha: string; reason: string }
    | { kind: "none"; reason: string };

/**
 * What a finished health run does to the ledger.
 *
 * **The gated sha is the RECORD's, never the one the fire snapshotted.** That
 * is the whole point of this function. `health-cadence detach` reads the tip,
 * stamps it, and then queues on the mutex — deliberately stepping aside for
 * queued lands, each of which ADVANCES the tip. By the time `health-main` runs
 * it re-resolves `origin/<base>` and gates whatever is current, which is
 * exactly what ADR 0136 §6 asks for ("gating the base tip CURRENT at its
 * start, so one run covers everything landed meanwhile") and is routinely NOT
 * the sha the fire saw. An equality check against the snapshot therefore
 * rejects the verdict of the very run it started: `lastGreenSha` is never
 * written, nothing is pruned, and the next landing fires another full gate —
 * the ADR 0110 regime, one ~10 min gate per landing, reinstated silently.
 * Scenario B in `docs/guides/next-issue-flow.md` § 2 is that case verbatim.
 *
 * A GREEN is adopted whoever produced it: a proven tip is proven, and a
 * concurrent run or `bun run release` proving it is not a reason to re-prove
 * it. A RED is only OURS to hand over if the record started at or after the
 * fire — an older RED marker has already been handed over once.
 */
export function reconcileHealthRun(
    state: CadenceState,
    input: { last: HealthRecord | null; firedAt: number }
): ReconcileAction {
    const { last, firedAt } = input;
    if (last === null) return { kind: "none", reason: "no health record" };
    const startedAt = Date.parse(last.startedAt);
    if (!Number.isFinite(startedAt))
        return {
            kind: "none",
            reason: `health record for ${short(last.sha)} has an unreadable startedAt`,
        };
    if (last.status === "running")
        return {
            kind: "none",
            reason: `${short(last.sha)} is still being gated`,
        };
    // INFRA (issue #4938): the machine, not the tree, failed the step — no
    // fixer, and the ledger stays as it is so the next landing re-fires.
    if (last.status === "infra")
        return {
            kind: "none",
            // A record from before issue #4943 carries no `reason`: those
            // were all the sleep rule.
            reason: `${short(last.sha)} is unproven at ${last.failedStep ?? "a step"} — ${last.reason ?? "the machine slept during the step"}`,
        };
    if (last.status === "green") {
        if (last.sha === state.lastGreenSha)
            return {
                kind: "none",
                reason: `${short(last.sha)} was already reconciled`,
            };
        return {
            kind: "green",
            sha: last.sha,
            state: clearPending(
                afterFire(
                    afterGreen(state, last.sha, startedAt),
                    last.sha,
                    startedAt
                )
            ),
            reason: `GREEN @ ${short(last.sha)} — batch reset`,
        };
    }
    if (startedAt < firedAt)
        return {
            kind: "none",
            reason: `the RED record about ${short(last.sha)} predates this run`,
        };
    return {
        kind: "red",
        sha: last.sha,
        state: clearPending(afterFire(state, last.sha, startedAt)),
        reason: `RED @ ${short(last.sha)}${last.failedStep ? ` (${last.failedStep})` : ""}`,
    };
}

/**
 * Is a health run already in flight? Then hold, whatever the ledger says and
 * whatever sha that run is about.
 *
 * Without this, the RED window costs a full gate per landing: RED refuses the
 * next PICK but not the next LAND, so the two or three sessions already
 * mid-issue each land, each lands on a new tip, and each new tip clears both
 * dedup checks. Up to ~30 mutex-minutes exactly when throughput matters most.
 * One run at a time is the invariant; a repair that lands during the run is
 * gated by the re-decision its `detach` makes once the run is done.
 *
 * `staleMs` mirrors `health-main.ts`'s own `STALE_RUNNING_MS`: a `running`
 * record older than that belongs to a run that died. Its age counts from the
 * current PHASE (`phaseStartedAt`, issue #4962) when there is one: offline
 * gates plus the browser walk can outlast `staleMs` together while each phase
 * stays well inside it.
 */
export function healthRunInFlight(
    last: HealthRecord | null,
    now: number,
    staleMs: number = FIRE_DEDUP_MS
): string | null {
    if (last === null || last.status !== "running") return null;
    const startedAt = Date.parse(last.phaseStartedAt ?? last.startedAt);
    if (!Number.isFinite(startedAt) || now - startedAt >= staleMs) return null;
    return `a health run on ${short(last.sha)} is already in flight`;
}

/**
 * Is a health run already queued OR running (issue #4964)? A `running` record
 * covers the run that holds the mutex; `pendingPid` covers the fire still
 * waiting for it, which `last.json` cannot see. `isAlive` is injected so the
 * decision stays pure — `detach` passes a `kill(pid, 0)` probe.
 */
export function pendingHealthRun(
    state: CadenceState,
    last: HealthRecord | null,
    now: number,
    isAlive: (pid: number) => boolean,
    maxPendingMs: number = MAX_PENDING_MS
): string | null {
    const running = healthRunInFlight(last, now);
    if (running !== null) return running;
    const { pendingPid, pendingSince } = state;
    if (
        pendingPid === null ||
        pendingSince === null ||
        now - pendingSince >= maxPendingMs ||
        !isAlive(pendingPid)
    )
        return null;
    return `a health run fired ${minutes(now - pendingSince)} ago is still queued or running (pid ${pendingPid})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// `land` under RED (issue #4964)
// ─────────────────────────────────────────────────────────────────────────────

/** The issues a PR body closes, by GitHub's own keywords. Only a BARE `#N`
 *  closes — `Closes issue #N` does not, so it does not count here either. */
export function closingIssueRefs(body: string): number[] {
    const refs = new Set<number>();
    const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi;
    for (const m of body.matchAll(re)) refs.add(Number(m[1]));
    return [...refs];
}

export type RedLandVerdict =
    | {
          kind: "proceed";
          /** What the ledger records for this landing; absent off RED. */
          landing?: LandingKind;
          note?: string;
      }
    | { kind: "refuse"; reason: string };

/**
 * May `land` merge this PR while the RED marker stands?
 *
 * A repair — a PR closing an issue `/health-fix` opened, or `--repair` — lands
 * as before. Anything else needs `--red-ok`: a session mid-issue can still
 * finish, but as a stated act the ledger counts, not by default.
 */
export function redLandGate(input: {
    red: boolean;
    prBody: string;
    repairIssues: readonly number[];
    repairFlag: boolean;
    redOkFlag: boolean;
}): RedLandVerdict {
    if (!input.red) return { kind: "proceed" };
    const closed = closingIssueRefs(input.prBody).filter((n) =>
        input.repairIssues.includes(n)
    );
    if (closed.length > 0)
        return {
            kind: "proceed",
            landing: "repair",
            note: `a declared repair — closes issue #${closed[0]}, opened by /health-fix`,
        };
    if (input.repairFlag)
        return {
            kind: "proceed",
            landing: "repair",
            note: "a declared repair (--repair)",
        };
    if (input.redOkFlag)
        return {
            kind: "proceed",
            landing: "red-ok",
            note: "unrelated work on a RED tip (--red-ok) — counted in the health ledger",
        };
    const known =
        input.repairIssues.length === 0
            ? "no /health-fix issue is recorded"
            : `it closes none of the /health-fix issues (${input.repairIssues.map((n) => `#${n}`).join(", ")})`;
    return {
        kind: "refuse",
        reason: `the health gate is RED and this PR is not a declared repair — ${known}. Pass --repair if it fixes the red tip, or --red-ok to land unrelated work anyway (counted)`,
    };
}
