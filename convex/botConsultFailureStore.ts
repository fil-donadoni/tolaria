// The bounded per-game record of FAILED Bot Brain consults (issue #9502).
//
// A Brain consult that ends in `search-error`, `worker-error` or `timeout`
// settles as "no move", and the vs-AI driver's escalation ladder then passes
// legally — every rung changes the state version, so `reportStall` never
// fires and the server used to record nothing. A Bot failing every consult
// played a whole game of passes indistinguishable, server-side, from a Bot
// that chose to pass. This record is that missing trace: the driver reports
// each failed consult (`botLiveness.reportConsultFailure`), a triager reads it
// by game id (`botLiveness.getConsultFailures`, and the counters ride on
// `bugReports.getReport`).
//
// NO CONSENT-GATED PAYLOAD. A bug report's client diagnostics (decision ring,
// traces, console, user agent) reach the server only with the reporter's
// diagnostics consent (issue #3255). This record is written WITHOUT consent,
// so it carries only what the server already knows or what names no person:
// the outcome kind, per-outcome counters, and the game-position coordinates
// (state `seq`, turn, phase, whether a land drop was legal) read from the
// game's own state — plus the Brain error's `message`, truncated, which is
// engine text, never user content. No hand contents, no decklist, no user
// agent, no diagnostics blob. Widening it past that line is a consent
// question, not a schema edit.
//
// BOUNDED. One row per game: three counters and a ring of the most recent
// samples, oldest dropped first. The fat `gameStates` row and the `gameTicks`
// wake-up row are never touched — their size budgets are load-bearing.
//
// A plain module (no Convex functions): `schema.ts` reads the validators, and
// both `botLiveness` (the writer) and `bugReports` (the triage read) read the
// helpers, without the two importing each other.

import { v, type Infer } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/** The three `BrainOutcome` members that mean the Brain gave NO answer. The
 *  other outcomes (`move`, `no-move`, and every driver-owned one) are never
 *  reported: a healthy game writes nothing here. */
export const CONSULT_FAILURE_OUTCOMES = [
    "search-error",
    "worker-error",
    "timeout",
] as const;
export type ConsultFailureOutcome = (typeof CONSULT_FAILURE_OUTCOMES)[number];

export const consultFailureOutcomeValidator = v.union(
    v.literal("search-error"),
    v.literal("worker-error"),
    v.literal("timeout")
);

/** Whether a consult outcome is one this record counts. */
export function isConsultFailureOutcome(
    outcome: string
): outcome is ConsultFailureOutcome {
    return (CONSULT_FAILURE_OUTCOMES as readonly string[]).includes(outcome);
}

/** How many recent samples a game's record keeps. */
export const CONSULT_FAILURE_SAMPLE_CAP = 20;
/** The longest Brain error message a sample keeps. */
export const CONSULT_FAILURE_MESSAGE_MAX = 200;

export const consultFailureCountsValidator = v.object({
    searchError: v.number(),
    workerError: v.number(),
    timeout: v.number(),
});
export type ConsultFailureCounts = Infer<typeof consultFailureCountsValidator>;

/** One failed consult. `turn`, `phase` and `landDropLegal` are read from the
 *  server's state and present only when that state is still the version the
 *  consult ran on — absent, never guessed. */
export const consultFailureSampleValidator = v.object({
    outcome: consultFailureOutcomeValidator,
    seq: v.number(),
    at: v.number(),
    turn: v.optional(v.number()),
    phase: v.optional(v.string()),
    landDropLegal: v.optional(v.boolean()),
    message: v.optional(v.string()),
});
export type ConsultFailureSample = Infer<typeof consultFailureSampleValidator>;

/** The `botConsultFailures` row's own fields. */
export const consultFailureRecordFields = {
    gameId: v.id("games"),
    counts: consultFailureCountsValidator,
    samples: v.array(consultFailureSampleValidator),
    updatedAt: v.number(),
};

/** The record as the internal query returns it. */
export const consultFailureRecordValidator = v.object({
    counts: consultFailureCountsValidator,
    samples: v.array(consultFailureSampleValidator),
    updatedAt: v.number(),
});
export type ConsultFailureRecord = Infer<typeof consultFailureRecordValidator>;

const COUNT_KEY: Record<ConsultFailureOutcome, keyof ConsultFailureCounts> = {
    "search-error": "searchError",
    "worker-error": "workerError",
    timeout: "timeout",
};

const ZERO_COUNTS: ConsultFailureCounts = {
    searchError: 0,
    workerError: 0,
    timeout: 0,
};

/** A message as a sample stores it: truncated, or absent. */
export function boundedConsultMessage(
    message: string | undefined
): string | undefined {
    if (message === undefined || message === "") return undefined;
    return message.length > CONSULT_FAILURE_MESSAGE_MAX
        ? `${message.slice(0, CONSULT_FAILURE_MESSAGE_MAX - 1)}…`
        : message;
}

/** The record after one more failure: its counter incremented, the sample
 *  appended, the ring cut to its cap from the OLDEST end. Pure. */
export function appendConsultFailure(
    prev: ConsultFailureRecord | null,
    sample: ConsultFailureSample
): ConsultFailureRecord {
    const counts = { ...(prev?.counts ?? ZERO_COUNTS) };
    counts[COUNT_KEY[sample.outcome]] += 1;
    const samples = [...(prev?.samples ?? []), sample].slice(
        -CONSULT_FAILURE_SAMPLE_CAP
    );
    return { counts, samples, updatedAt: sample.at };
}

/** The stored row for a game, if any. */
export async function readConsultFailureRow(
    ctx: Pick<QueryCtx, "db">,
    gameId: Id<"games">
): Promise<Doc<"botConsultFailures"> | null> {
    return await ctx.db
        .query("botConsultFailures")
        .withIndex("by_gameId", (q) => q.eq("gameId", gameId))
        .unique();
}

/** The record for a game — `null` when its Bot never failed a consult. */
export async function readConsultFailures(
    ctx: Pick<QueryCtx, "db">,
    gameId: Id<"games">
): Promise<ConsultFailureRecord | null> {
    const row = await readConsultFailureRow(ctx, gameId);
    if (!row) return null;
    return {
        counts: row.counts,
        samples: row.samples,
        updatedAt: row.updatedAt,
    };
}
