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
 * Node builtins only — nothing here imports anything at all, so `land`'s
 * locked command can reach the CLI around it without dragging a module graph
 * into a shell step that must never fail.
 */

/** One landing on the base branch: the tip it created, and when it merged. */
export interface Landing {
    /** The base-branch tip the squash produced — what a health run would gate. */
    sha: string;
    /** Epoch ms, from the `land` that merged it. */
    at: number;
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
}

export const EMPTY_CADENCE: CadenceState = {
    landings: [],
    lastGreenSha: null,
    lastFiredSha: null,
    lastFiredAt: null,
};

/** Landings since the last GREEN after which the batch gate fires. */
export const LANDINGS_PER_BATCH = 5;
/** Age of the FIRST un-healthed landing after which it fires regardless. */
export const MAX_BATCH_AGE_MS = 2 * 60 * 60 * 1000;
/** How long a fire suppresses another on the same tip. The same 90 minutes
 *  `health-main.ts` gives its own `running` record, and for the same reason:
 *  past it, a run that left no verdict is assumed gone rather than slow. */
export const FIRE_DEDUP_MS = 90 * 60 * 1000;

export type CadenceVerdict =
    | {
          kind: "fire";
          /** Which of the two thresholds tripped — the reason a reader wants. */
          trigger: "count" | "age";
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
 * Note what is NOT here: a RED verdict does not change the state, so the next
 * landing — on a NEW tip, hence past the dedup — fires again. That is the
 * point: RED refuses the next PICK (`queue:plan`) but not the next LAND, so
 * the landing that carries the fix-forward is gated at once instead of waiting
 * out another batch.
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
 * Record a landing. Idempotent on the tip already at the tail: a `land`
 * retried after a transient merge refusal re-runs its post-merge steps
 * against the SAME base tip (ADR 0136 §2 is the whole reason a retry is
 * cheap), and counting that twice would fire the batch gate a landing early.
 */
export function recordLanding(
    state: CadenceState,
    sha: string,
    at: number
): CadenceState {
    const last = state.landings[state.landings.length - 1];
    if (last?.sha === sha) return state;
    return { ...state, landings: [...state.landings, { sha, at }] };
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
    return { ...state, landings, lastGreenSha: gatedSha };
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
              return [{ sha: e.sha, at: e.at }];
          })
        : [];
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
        lastFiredAt:
            typeof record.lastFiredAt === "number" &&
            Number.isFinite(record.lastFiredAt)
                ? record.lastFiredAt
                : null,
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
    status: "running" | "green" | "red";
    /** ISO, as `health-main.ts` writes it. */
    startedAt: string;
    failedStep?: string;
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
    if (last.status === "green") {
        if (last.sha === state.lastGreenSha)
            return {
                kind: "none",
                reason: `${short(last.sha)} was already reconciled`,
            };
        return {
            kind: "green",
            sha: last.sha,
            state: afterFire(
                afterGreen(state, last.sha, startedAt),
                last.sha,
                startedAt
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
        state: afterFire(state, last.sha, startedAt),
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
 * One run at a time is the invariant; the counter still is not reset on RED,
 * so the fix-forward is still gated as soon as the current run is done.
 *
 * `staleMs` mirrors `health-main.ts`'s own `STALE_RUNNING_MS`: a `running`
 * record older than that belongs to a run that died.
 */
export function healthRunInFlight(
    last: HealthRecord | null,
    now: number,
    staleMs: number = FIRE_DEDUP_MS
): string | null {
    if (last === null || last.status !== "running") return null;
    const startedAt = Date.parse(last.startedAt);
    if (!Number.isFinite(startedAt) || now - startedAt >= staleMs) return null;
    return `a health run on ${short(last.sha)} is already in flight`;
}
