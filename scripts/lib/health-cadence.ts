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
}

export const EMPTY_CADENCE: CadenceState = {
    landings: [],
    lastGreenSha: null,
    lastFiredSha: null,
};

/** Landings since the last GREEN after which the batch gate fires. */
export const LANDINGS_PER_BATCH = 5;
/** Age of the FIRST un-healthed landing after which it fires regardless. */
export const MAX_BATCH_AGE_MS = 2 * 60 * 60 * 1000;

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
    } = input;

    if (state.landings.length === 0)
        return { kind: "hold", reason: "no landing since the last health run" };
    if (tip === state.lastGreenSha)
        return {
            kind: "hold",
            reason: `tip ${short(tip)} is already GREEN`,
        };
    if (tip === state.lastFiredSha)
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
 *  gate runs so a second detach on the same tip holds even while it runs. */
export function afterFire(state: CadenceState, sha: string): CadenceState {
    return { ...state, lastFiredSha: sha };
}

/**
 * GREEN at `gatedSha` — the counter resets.
 *
 * "Resets" is not "empties": health gates the tip CURRENT at its start, so one
 * run covers every landing up to that tip and NONE of the landings that merged
 * while it ran (scenario B, #6–#11). The gated tip is normally one of the
 * recorded landings, and everything up to and including it is covered; when it
 * is not (a push that did not come through `land`), `startedAt` is the
 * fallback cut — a landing recorded after the run began is a descendant of the
 * gated tip and stays un-healthed.
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
            : state.landings.filter((l) => l.at > startedAt);
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
    };
}

export function serializeCadence(state: CadenceState): string {
    return `${JSON.stringify(state, null, 2)}\n`;
}
