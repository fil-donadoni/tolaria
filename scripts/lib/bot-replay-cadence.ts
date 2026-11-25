/**
 * The Bot-play replay's cadence (issue #7925).
 *
 * WHY. The replay (`derive:sync --replay-bot`, post-merge's `bot-replay` job
 * on the MacBook's `maint` runner) sweeps every `ready` card, ~6,600, on 4
 * worker threads whenever the base's Bot hash moved. Measured 2026-11-02
 * 12:00Z → 11-03 07:00Z: 18 whole sweeps in 19 h, 19–120 min each, back to
 * back — about 2.4 of the machine's 8 cores, all the time. The hash moves
 * for real code (101 of 103 moves in the week to 11-03 changed transpiled
 * code, not comments), so it cannot be made to move less. Until PR #7519
 * retired the heavy mutex (2026-10-30), the sweep gave way to health on it
 * (issue #6524). Since then it runs beside health's `test` step, and
 * `test:app` went from a ~290 s median to 680–2,511 s whenever the two
 * overlapped.
 *
 * The lever is the CADENCE: a push-triggered replay sweeps only when the last whole sweep
 * landed at least `botReplay.minIntervalMinutes` ago. Any later base push
 * asks again (landings come every few minutes), and the nightly or a
 * dispatch always sweeps. A held-back replay is owed only once a push
 * lands past the interval, since none asks before that: a `bot-hash` lag
 * counts as late from that push (`botHashLateSinceMs`), never from the move a
 * throttled push saw. A quiet base (no landing until the nightly) is
 * therefore never filed as late. The lockfile has always carried a lag
 * between sweeps (health stays GREEN on a late replay, ADR 0159).
 *
 * The CPU priority is not set here but on the `lane` runner's unit
 * (`ProcessType` Interactive, `scripts/lib/github-runner.ts`): measured on the
 * same day, it is health that must be raised, not the sweep lowered.
 *
 * Every function here is pure. `scripts/derive-sync.ts` does the I/O.
 */

/** The `botReplay` block of `tolaria.config.json`, read by this module ONLY. */
export interface BotReplayConfig {
    /** Minutes a push-triggered replay waits after the last whole sweep. */
    minIntervalMinutes: number;
}

/** Four hours: about 15 Bot-hash moves a day (103 in the week to 11-03)
 *  become at most six push-triggered sweeps plus the nightly, against 18 in
 *  19 h before. */
export const DEFAULT_MIN_INTERVAL_MINUTES = 240;

export function parseBotReplayConfig(raw: unknown): BotReplayConfig {
    const v = (raw as { botReplay?: { minIntervalMinutes?: unknown } } | null)
        ?.botReplay?.minIntervalMinutes;
    return {
        minIntervalMinutes:
            typeof v === "number" && Number.isFinite(v) && v >= 0
                ? v
                : DEFAULT_MIN_INTERVAL_MINUTES,
    };
}

/** The last replay started, landed or not (`bot-replay-journal.ts`). */
export interface BotReplayAttempt {
    readonly startedAtMs: number;
    /** It swept the tree's Bot and left verdicts to resume from. */
    readonly resumable: boolean;
}

export type CadenceDecision =
    | { readonly kind: "due"; readonly why: string }
    | {
          readonly kind: "throttled";
          readonly lastAtMs: number;
          /** False: the sweep held against is one that never landed. */
          readonly landed: boolean;
          readonly nextDueAtMs: number;
      };

/**
 * Whether this replay sweeps now. Only a `push`-triggered run is ever
 * throttled: the nightly (`schedule`), a dispatch and a by-hand run (no
 * `GITHUB_EVENT_NAME`) always sweep. With no whole sweep on the base's
 * history (`lastSweepAtMs` null) it is due.
 *
 * A replay that started after the last landed sweep and did not land counts
 * like a landed one (issue #10737): before, a sweep its wall cut was due again
 * at the next push, and two-hour runs followed each other from zero. One left
 * RESUMABLE is due at once instead — it plays only what is missing, so every
 * run brings the same Bot's sweep closer to its end.
 */
export function botReplayCadence(input: {
    readonly event: string | undefined;
    readonly lastSweepAtMs: number | null;
    readonly nowMs: number;
    readonly minIntervalMinutes: number;
    readonly attempt: BotReplayAttempt | null;
}): CadenceDecision {
    if (input.event !== "push")
        return {
            kind: "due",
            why: `${input.event ?? "a by-hand run"} always sweeps`,
        };
    const unlanded =
        input.attempt !== null &&
        input.attempt.startedAtMs > (input.lastSweepAtMs ?? 0)
            ? input.attempt
            : null;
    if (unlanded?.resumable === true)
        return { kind: "due", why: "an unlanded sweep of this Bot resumes" };
    const lastAtMs = unlanded?.startedAtMs ?? input.lastSweepAtMs;
    if (lastAtMs === null)
        return { kind: "due", why: "no whole sweep on the base's history" };
    const nextDueAtMs = lastAtMs + input.minIntervalMinutes * 60_000;
    if (input.nowMs >= nextDueAtMs)
        return {
            kind: "due",
            why: `the last ${unlanded === null ? "whole sweep" : "attempt"} is ${Math.round((input.nowMs - lastAtMs) / 60_000)} min old (interval ${input.minIntervalMinutes} min)`,
        };
    return {
        kind: "throttled",
        lastAtMs,
        landed: unlanded === null,
        nextDueAtMs,
    };
}

/**
 * Since when a `bot-hash` lag is late (issue #7925), or null when the
 * cadence still holds the replay back. A move after the cadence's due time
 * is owed at once (its own push asks), so it counts from the move. A move
 * inside the interval counts from the first base commit that landed at or
 * after the due time, the push that asked again; with none, nothing has
 * asked yet. With no whole sweep on the history (`dueAtMs` null) it counts
 * from the move.
 */
export function botHashLateSinceMs(input: {
    readonly movedAtMs: number;
    readonly dueAtMs: number | null;
    readonly firstCommitAtOrAfterDueMs: number | null;
}): number | null {
    if (input.dueAtMs === null || input.movedAtMs >= input.dueAtMs)
        return input.movedAtMs;
    return input.firstCommitAtOrAfterDueMs;
}
