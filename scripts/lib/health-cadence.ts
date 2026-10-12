/**
 * The per-batch health CADENCE decision (ADR 0136 §6, issue #3780), as pure
 * functions over hand-buildable inputs.
 *
 * `land` pays the LANE gate and nothing else. The FULL gate — `health-main.ts`
 * — used to run once per release (ADR 0116), which left a red base tip
 * standing for the 1–2 days observed between releases while every new worktree
 * branched from it. It now runs per BATCH of landings: after the 20th landing
 * since the last GREEN, or 8 h after the first un-healthed one, whichever
 * comes first (`LANDINGS_PER_BATCH` / `MAX_BATCH_AGE_MS`).
 *
 * This module owns the decision; `scripts/health-cadence.ts` owns the side
 * effects (the ledger file, the fetch, the detached gate). The scenarios the
 * rules exist to satisfy are A/B/C in `docs/guides/next-ticket-flow.md` § 2.
 *
 * Node builtins only — nothing here imports anything at runtime (one
 * erased type import), so `land`'s locked command can reach the CLI around it
 * without dragging a module graph into a shell step that must never fail.
 */
import type { HealthStatus } from "./health-verdict";
import type { Lineage, Verdict } from "./health-verdict-store";

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
     *  exposure §6 bounds at "≤ 20 landings or 8 h". */
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

/**
 * The two thresholds (ADR 0154, issue #5458), derived from the 10 landings/h
 * target over two machines: 20 landings is one full suite per ~2 h at that
 * rate, and 8 h bounds a slow day's exposure at one working session. The old
 * 10 / 4 h fired mostly by AGE, for batches of 1–4 landings, and held the
 * mutex 1–4 h a day (14 days to 2026-10-11, `detach.log`) — health is a
 * proof of the tree per batch, not per landing, and `land`'s lane already
 * pays what each PR can break.
 */
/** Landings since the last GREEN after which the batch gate fires. */
export const LANDINGS_PER_BATCH = 20;
/** Age of the FIRST un-healthed landing after which it fires regardless. */
export const MAX_BATCH_AGE_MS = 8 * 60 * 60 * 1000;
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
           *  only under RED: a declared repair landed since the last fire.
           *  `unproven` and `stale` are the health runner's (issue #5467):
           *  no verdict to count from, and the MacBook's fallback when the
           *  runner's verdicts stopped coming. */
          trigger: "count" | "age" | "repair" | "unproven" | "stale";
          /** The tip to gate: the one CURRENT now, not the one that triggered. */
          sha: string;
          reason: string;
          /** Epoch ms the batch became due: the landing that filled it, the
           *  moment the oldest one turned `maxAgeMs` old, or the repair. The
           *  stale-verdict fallback measures the runner's silence from it. */
          dueAt?: number;
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
            dueAt: state.landings[landingsPerBatch - 1].at,
        };
    if (ageMs >= maxAgeMs)
        return {
            kind: "fire",
            trigger: "age",
            sha: tip,
            reason: `the oldest un-healthed landing is ${minutes(ageMs)} old (threshold ${minutes(maxAgeMs)})`,
            dueAt: state.landings[0].at + maxAgeMs,
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
            dueAt: repair.at,
        };
    const count = since.length;
    const ageMs = now - since[0].at;
    if (count >= landingsPerBatch)
        return {
            kind: "fire",
            trigger: "count",
            sha: tip,
            reason: `RED: ${count} landings since the last fire (threshold ${landingsPerBatch})`,
            dueAt: since[landingsPerBatch - 1].at,
        };
    if (ageMs >= maxAgeMs)
        return {
            kind: "fire",
            trigger: "age",
            sha: tip,
            reason: `RED: the oldest landing since the last fire is ${minutes(ageMs)} old (threshold ${minutes(maxAgeMs)})`,
            dueAt: since[0].at + maxAgeMs,
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
    /** `running` only: `walk` once the offline gates passed (issue #4962). */
    phase?: "walk";
    /** The browser walk's state; `pending` = owed, nobody walking yet. */
    ui?: string;
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
 * Scenario B in `docs/guides/next-ticket-flow.md` § 2 is that case verbatim.
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
 * Why `health-main` must NOT gate `tip` now, or null to gate it.
 *
 * A tip already green, or being gated by a live run, is never re-gated. A
 * tip with a RED or INFRA verdict is re-gated only on an explicit decision
 * (`retryTerminal`: `bun run health` or `release` by hand): a cadence waiter
 * (`--under-lock`) that wakes after a 36–49 min queue to a tip some other
 * run already concluded on exits instead (issue #4960). Before that, every
 * leftover waiter re-ran the whole ~45 min gate on the same sha — an infra
 * blip became a second full run, competing with every queued `land`. A tip
 * that moved since the verdict is a different sha, and is gated.
 */
export function gateSkipReason(input: {
    last: HealthRecord | null;
    tip: string;
    now: number;
    retryTerminal: boolean;
    staleMs?: number;
}): string | null {
    const { last, tip, now, retryTerminal } = input;
    if (last === null || last.sha !== tip) return null;
    if (last.status === "green") return `tip ${short(tip)} already green`;
    if (last.status === "running")
        return healthRunInFlight(last, now, input.staleMs) === null
            ? null
            : `tip ${short(tip)} already being gated`;
    if (retryTerminal) return null;
    return `tip ${short(tip)} already has a ${last.status.toUpperCase()} verdict${last.failedStep ? ` (${last.failedStep})` : ""} — a waiter never re-gates it; \`bun run health\` retries by hand`;
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

/**
 * Whether the offline phase of THIS fire left the browser walk owed (issue
 * #4962): a `running` record in `phase: "walk"` that nobody walks yet, started
 * no earlier than the fire. `health-main --phase=offline` exits 0 also when it
 * did nothing ("already green", "already being gated"), and a walk owed by
 * some other run is that run's to walk.
 */
export function walkOwedSince(
    last: HealthRecord | null,
    firedAt: number
): boolean {
    if (
        last === null ||
        last.status !== "running" ||
        last.phase !== "walk" ||
        last.ui !== "pending"
    )
        return false;
    const startedAt = Date.parse(last.startedAt);
    return Number.isFinite(startedAt) && startedAt >= firedAt;
}

// ─────────────────────────────────────────────────────────────────────────────
// The health runner (issue #5467, ADR 0154 §9)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One first-parent commit of the base branch, as `git log --format='%H %ct'`
 * reads it. A squash merge's committer time is its merge time, so this IS the
 * landing `land` would have recorded — without a ledger to carry across
 * machines.
 */
export interface BaseCommit {
    sha: string;
    /** Epoch ms. */
    at: number;
}

/** The runner's own dedup stamp: the tip it last started health on. */
export interface RunnerFire {
    sha: string;
    at: number;
}

/**
 * The sha the runner counts landings FROM: the tip the lineage's newest
 * completed run gated. GREEN and RED are their own sha; an AMBER is a
 * landing AFTER the red it repairs, so the count starts at that red and the
 * repair is one of the landings (`runnerPlan` marks it `repair`). Null when
 * the store holds no completed verdict in its history — infra only proves
 * nothing, so it is never a base.
 */
export function runnerBase(lineage: Lineage): string | null {
    const v = lineage.verdict;
    if (v === null) return null;
    switch (lineage.kind) {
        case "green":
        case "red":
        case "second-red":
            return v.sha;
        case "amber":
            return v.repairOf ?? null;
        default:
            return null;
    }
}

export type RunnerPlan = CadenceVerdict | { kind: "stop"; reason: string };

export interface RunnerPlanInput {
    /** The base tip as fetched now. */
    tip: string;
    lineage: Lineage;
    /** First-parent commits in `(runnerBase(lineage) .. tip]`, oldest first;
     *  null when there is no base, or it is not an ancestor of the tip. */
    commits: BaseCommit[] | null;
    lastFire: RunnerFire | null;
    /** A run already in flight on this machine (`healthRunInFlight`). */
    pending?: string | null;
    now: number;
    landingsPerBatch?: number;
    maxAgeMs?: number;
    fireDedupMs?: number;
}

/**
 * Whether the health runner gates `tip` now — the SAME rule `land`'s
 * `health-cadence detach` applies on the MacBook, never a second one. The
 * runner has no ledger: it rebuilds the `CadenceState` `healthTrigger` reads
 * from the verdict store and git, so no file crosses machines and no ssh is
 * needed (ADR 0154 §9):
 *
 *  - the un-healthed landings are the base commits after the last gated tip;
 *  - `lastGreenSha` is that tip when the lineage is GREEN;
 *  - the dedup stamp is the runner's own last fire;
 *  - RED, AMBER or SECOND RED is `red`: thresholds count from the last fire,
 *    and the AMBER commit — a proved repair `land` declared — fires at once.
 *
 * A SECOND RED stops the runner as it stops the loop: the repair did not
 * hold, and gating every batch after it only re-reports the red. A new AMBER
 * (the next proved repair) or a GREEN by hand ends the stop.
 *
 * No completed verdict to count from, or a base the tip does not descend from
 * (a force-push), is `unproven`: nothing proves the base, so it is gated —
 * still behind the dedup and an in-flight run.
 */
export function runnerPlan(input: RunnerPlanInput): RunnerPlan {
    const { tip, lineage, commits, lastFire, now } = input;
    const fireDedupMs = input.fireDedupMs ?? FIRE_DEDUP_MS;
    if (lineage.kind === "second-red")
        return {
            kind: "stop",
            reason: `SECOND RED @ ${short(lineage.verdict?.sha ?? "unknown")} on this lineage — the repair did not hold; the runner gates nothing until a proved repair (AMBER) or a GREEN`,
        };
    const base = runnerBase(lineage);
    if (base === null || commits === null) {
        if (
            lastFire !== null &&
            lastFire.sha === tip &&
            now - lastFire.at < fireDedupMs
        )
            return {
                kind: "hold",
                reason: `health already started for tip ${short(tip)}`,
            };
        if (input.pending) return { kind: "hold", reason: input.pending };
        return {
            kind: "fire",
            trigger: "unproven",
            sha: tip,
            reason:
                base === null
                    ? `no GREEN or RED in the verdict store's history — nothing proves ${short(tip)}`
                    : `the last gated tip ${short(base)} is not an ancestor of ${short(tip)}`,
        };
    }
    const amberSha = lineage.kind === "amber" ? lineage.verdict?.sha : null;
    const state: CadenceState = {
        ...EMPTY_CADENCE,
        landings: commits.map((c) =>
            c.sha === amberSha
                ? { sha: c.sha, at: c.at, kind: "repair" as const }
                : { sha: c.sha, at: c.at }
        ),
        lastGreenSha: lineage.kind === "green" ? base : null,
        lastFiredSha: lastFire?.sha ?? null,
        lastFiredAt: lastFire?.at ?? null,
    };
    return healthTrigger({
        state,
        tip,
        now,
        red: lineage.kind === "red" || lineage.kind === "amber",
        pending: input.pending,
        landingsPerBatch: input.landingsPerBatch,
        maxAgeMs: input.maxAgeMs,
        fireDedupMs,
    });
}

/**
 * The MacBook's cadence when the health runner gates on ANOTHER machine
 * (`healthRunner.platform`, issue #5467): `land`'s `detach` still decides by
 * its own ledger, but a FIRE is the runner's to make. It becomes ONE local
 * run only when the runner went silent on that batch: no GREEN or RED was
 * written since the batch became due (`dueAt`), and `maxPendingMs`
 * (`MAX_PENDING_MS`, ADR 0154 §9) has passed since. Silence is measured from
 * the batch, never from the newest verdict: a base quiet for a day carries an
 * old verdict and a live runner, and an age-fired batch is 8 h past its last
 * verdict by construction.
 *
 * `infra` and AMBER prove nothing about a batch, so only a GREEN or RED
 * answers it. The fallback runs once per batch (`lastLocalFireAt`): if its
 * own verdict cannot be written, the next landing does not pay another full
 * gate. A SECOND RED stands it down — the loop has stopped and the owner has
 * been notified; a local run would only report the same red.
 */
export function staleVerdictPlan(input: {
    trigger: CadenceVerdict;
    lineage: Lineage;
    /** The ledger's last fire before this decision: a local run, or a
     *  runner RED adopted earlier (always before the batch it counts). */
    lastLocalFireAt: number | null;
    now: number;
    maxPendingMs?: number;
}): CadenceVerdict {
    const { trigger, lineage, now } = input;
    const maxPendingMs = input.maxPendingMs ?? MAX_PENDING_MS;
    if (trigger.kind === "hold") return trigger;
    if (lineage.kind === "second-red")
        return {
            kind: "hold",
            reason: "SECOND RED on this lineage — the loop is stopped and the owner notified; no local fallback",
        };
    const dueAt = trigger.dueAt ?? now;
    const gated = gatedVerdict(lineage);
    const gatedAt = gated?.at ? Date.parse(gated.at) : Number.NaN;
    if (gated !== null && Number.isFinite(gatedAt) && gatedAt >= dueAt)
        return {
            kind: "hold",
            reason: `the health runner answered this batch — ${gated.status.toUpperCase()} @ ${short(gated.sha)}${gated.machine ? ` (${gated.machine})` : ""}`,
        };
    if (input.lastLocalFireAt !== null && input.lastLocalFireAt >= dueAt)
        return {
            kind: "hold",
            reason: "one local fallback run already started for this batch",
        };
    if (now - dueAt < maxPendingMs)
        return {
            kind: "hold",
            reason: `the health runner owns this batch — due ${minutes(now - dueAt)} ago, fallback after ${minutes(maxPendingMs)}`,
        };
    return {
        kind: "fire",
        trigger: "stale",
        sha: trigger.sha,
        reason: `stale verdict: the batch has been due ${minutes(now - dueAt)} (threshold ${minutes(maxPendingMs)}) with no GREEN or RED since; ${trigger.reason} — one local health run`,
        dueAt,
    };
}

/** The lineage's newest COMPLETED run — a GREEN or a RED — or null. */
function gatedVerdict(lineage: Lineage): Verdict | null {
    const v = lineage.verdict;
    if (v === null) return null;
    return v.status === "green" || v.status === "red" ? v : null;
}

/**
 * The runner's verdict, adopted into the MacBook's ledger as its own would
 * be: a GREEN resets the batch (`afterGreen`; when the green sha is not a
 * recorded landing nothing is pruned — a landing wrongly marked covered costs
 * the coverage the fallback exists for), a RED becomes the last fire, so the
 * RED thresholds count from it as they do after a local run. Returns `state`
 * itself when there is nothing new, so the caller writes only on a change.
 */
export function adoptRemoteVerdict(
    state: CadenceState,
    lineage: Lineage
): CadenceState {
    const v = gatedVerdict(lineage);
    if (v === null) return state;
    const at = v.at ? Date.parse(v.at) : Number.NaN;
    if (v.status === "green")
        return v.sha === state.lastGreenSha
            ? state
            : afterGreen(state, v.sha, Number.NEGATIVE_INFINITY);
    if (!Number.isFinite(at) || v.sha === state.lastFiredSha) return state;
    return afterFire(state, v.sha, at);
}

/** `healthRunner` in `tolaria.config.json` (issue #5467). */
export interface HealthRunnerConfig {
    /** `process.platform` of the machine whose runner gates batch health, or
     *  null when no runner is configured: every machine's `land` cadence
     *  gates locally, as before topology B'. */
    platform: string | null;
}

export function parseHealthRunnerConfig(raw: unknown): HealthRunnerConfig {
    const block = (raw as { healthRunner?: Record<string, unknown> } | null)
        ?.healthRunner;
    return {
        platform:
            typeof block?.platform === "string" && block.platform.length > 0
                ? block.platform
                : null,
    };
}

/** Where batch health runs, seen from `platform`: `here` (the runner gates),
 *  `remote` (another machine's runner gates; `land`'s cadence is the stale
 *  fallback), `local` (no runner: `land`'s cadence gates). */
export function healthRunnerMode(
    config: HealthRunnerConfig,
    platform: string
): "here" | "remote" | "local" {
    if (config.platform === null) return "local";
    return config.platform === platform ? "here" : "remote";
}

/**
 * `land`'s `detach` decision when the runner is on another machine: the
 * runner's verdict adopted into the ledger, the ledger's trigger, then
 * `staleVerdictPlan`. An unreadable store holds — the fallback run would
 * write its verdict to the same store, and a GitHub blip must not cost a
 * full local gate.
 */
export function remoteCadenceDecision(
    input: TriggerInput & {
        readLineage: () => Lineage;
        maxPendingMs?: number;
    }
): { verdict: CadenceVerdict; state: CadenceState; lineage: Lineage | null } {
    let lineage: Lineage;
    try {
        lineage = input.readLineage();
    } catch (err) {
        return {
            verdict: {
                kind: "hold",
                reason: `the verdict store is unreadable (${String(err)}) — the health runner's verdict cannot be checked`,
            },
            state: input.state,
            lineage: null,
        };
    }
    // The MacBook's own last fire, read BEFORE a remote RED becomes it.
    const lastLocalFireAt = input.state.lastFiredAt;
    const state = adoptRemoteVerdict(input.state, lineage);
    const trigger = healthTrigger({ ...input, state });
    return {
        verdict: staleVerdictPlan({
            trigger,
            lineage,
            lastLocalFireAt,
            now: input.now,
            maxPendingMs: input.maxPendingMs,
        }),
        state,
        lineage,
    };
}
