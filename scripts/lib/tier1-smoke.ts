/**
 * The Premodern Tier 1 deck-vs-deck Bot smoke — plan, classification and
 * receipt (issue #2719, PRD #2693 M1 acceptance).
 *
 * WHAT IT PROVES, and what it deliberately does not. M1 asks that the Bot can
 * PLAY the nine Tier 1 lists: "no freeze, no illegal move over a full game
 * against each other deck". That is a LIVENESS claim, not a strength one, and
 * the two have different instruments:
 *
 *  - strength is the ladder's job (`scripts/ladder.ts`), paired-design A/B over
 *    a pairing registry — and PRD #2693 keeps strength out of M1 explicitly;
 *  - a point BLUNDER is the blade's job (`convex/gre/ai/blade/`), a curated
 *    position where a human can say what the bot must do;
 *  - liveness is neither. It is the absence of a guard stop over a whole game,
 *    and `runHeadlessGame` already computes exactly that signal: `stall`,
 *    `max-plies`, `resolution-error` and `search-error` are its four harness
 *    guards, each naming a bug rather than an MTG outcome (issue #2284 added
 *    `unhandledExpectedInput` alongside them, which names the Expected Input
 *    window nobody drove).
 *
 * So the smoke plays real games and asserts only that every one of them ended
 * as MTG, never as a guard. A new card the Bot cannot answer shows up here as a
 * `stall` naming its window — the failure mode `.claude/rules/bot-development.md`
 * calls "ignored and frozen are both unshipped".
 *
 * This module is the PURE half: the pairing plan, the seed derivation, the
 * freeze classification and the receipt text. It touches no engine, so the gate
 * can test it in milliseconds while the games themselves stay a CLI
 * (`scripts/tier1-smoke.ts`) — the same split, for the same reason, as
 * `scripts/lib/ladder/plan.ts`: vitest buffers stdout, and a 20-minute run that
 * prints nothing until it finishes is how the silent four-hour corpus run of
 * 2026-07-29 happened.
 */

import type { GameEndReason } from "../../src/lib/ai/selfplay/playGame";

/** Search budget for one smoke seat. Fixed ITERATIONS, never wall-clock — a
 *  receipt pasted in a PR has to reproduce on another machine (decision #1895
 *  §2). Well under the ladder's 400: liveness does not improve with depth, and
 *  the matrix is 15 full games. */
export const SMOKE_ITERATIONS = 60;

/** Base seed of the standard run. A smoke quoted in a PR comes from this. */
export const SMOKE_BASE_SEED = 27190;

/**
 * Why a game ended, as ONE exhaustive table rather than a list of the bad ones.
 *
 * `Record<GameEndReason, …>` is the point: `GameEndReason` is the harness's
 * union, and a reason added there tomorrow reds `tsc` here instead of silently
 * landing on the permissive side of an `includes()` — a new guard kind that
 * counted as "fine" would make this whole smoke vacuous.
 */
export const REASON_IS_FREEZE: Record<GameEndReason, boolean> = {
    // Real MTG outcomes — the game ended because the rules ended it.
    life: false,
    decked: false,
    concede: false,
    draw: false,
    poison: false,
    "alternate-win": false,
    // Harness guards — every one of them is a bug, not a result.
    stall: true,
    "max-plies": true,
    "resolution-error": true,
    "search-error": true,
};

/**
 * An uncaught throw out of the game loop. Not a `GameEndReason`: the harness
 * guards what it can (`search-error` wraps the ISMCTS call, `resolution-error`
 * the resolver), but `applyMoveInSearch` on the chosen move is NOT wrapped — an
 * illegal move reaching it crashes the process. That crash is the "no illegal
 * move" half of the acceptance criterion, so the runner catches it at the
 * boundary and reports it under this name.
 */
export const CRASH_REASON = "crash";

export type SmokeReason = GameEndReason | typeof CRASH_REASON;

export function isFreeze(reason: SmokeReason): boolean {
    return reason === CRASH_REASON || REASON_IS_FREEZE[reason];
}

export interface SmokePair {
    /** Index in the FULL plan — what the seed derives from, so a filtered run
     *  reproduces the matching subset of a full one bit for bit. */
    readonly index: number;
    /** Slug seated on the play. */
    readonly deckSeat0: string;
    /** Slug seated on the draw. */
    readonly deckSeat1: string;
}

/**
 * Every unordered pair of DISTINCT decks — "each deck against each other deck",
 * 15 games for six lists. Mirrors are left out because the criterion names the
 * other decks, and a mirror costs a full game to exercise a strictly smaller
 * card pool than the two pairings its deck is already in.
 *
 * Seating alternates by pair index parity so no deck is always on the play:
 * without it deck #1 would open all five of its games and the last deck none,
 * and an on-the-draw-only freeze (a first-turn trigger that never fires when
 * you are on the play) would be invisible for half the pool.
 */
export function smokePairs(slugs: readonly string[]): SmokePair[] {
    const pairs: SmokePair[] = [];
    for (let a = 0; a < slugs.length; a++) {
        for (let b = a + 1; b < slugs.length; b++) {
            const index = pairs.length;
            const flip = index % 2 === 1;
            pairs.push({
                index,
                deckSeat0: flip ? slugs[b] : slugs[a],
                deckSeat1: flip ? slugs[a] : slugs[b],
            });
        }
    }
    return pairs;
}

/** Game `index`'s seed. Derived from the plan index, never from the position in
 *  a filtered subset — see `SmokePair.index`. */
export function smokeSeed(baseSeed: number, index: number): number {
    return baseSeed + index * 7919;
}

/** Restrict a plan to the pairs naming one of `slugs`, KEEPING each pair's
 *  index (and therefore its seed). Empty `slugs` ⇒ the whole plan. */
export function filterPairs(
    pairs: readonly SmokePair[],
    slugs: readonly string[]
): SmokePair[] {
    if (slugs.length === 0) return [...pairs];
    const wanted = new Set(slugs);
    return pairs.filter(
        (p) => wanted.has(p.deckSeat0) || wanted.has(p.deckSeat1)
    );
}

export interface SmokeResult extends SmokePair {
    readonly reason: SmokeReason;
    readonly turns: number;
    readonly plies: number;
    /** Seat id that won, or null for a guard stop / crash. */
    readonly winner: string | null;
    /** The Expected Input kind the game was resting on when a guard fired
     *  (issue #2284) — the whole point of reporting a stall rather than
     *  counting it, since it names the window nobody drove. */
    readonly unhandledExpectedInput?: string;
    /** Message of the throw, for `crash` only. */
    readonly error?: string;
    readonly seconds: number;
}

/** One receipt row. Fixed-width so a matrix of them reads as a table. */
export function smokeRow(r: SmokeResult): string {
    const matchup = `${r.deckSeat0} vs ${r.deckSeat1}`;
    const detail =
        r.error !== undefined
            ? `  ${r.error}`
            : r.unhandledExpectedInput !== undefined
              ? `  expectedInput=${r.unhandledExpectedInput}`
              : "";
    return (
        `${isFreeze(r.reason) ? "FREEZE" : "  ok  "} ` +
        `${matchup.padEnd(38)}${r.reason.padEnd(17)}` +
        `${`T${r.turns}`.padStart(5)}${`${r.plies}p`.padStart(7)}` +
        `${`${r.seconds.toFixed(0)}s`.padStart(6)}${detail}`
    );
}

export interface SmokeSummary {
    readonly games: number;
    readonly freezes: number;
    readonly byReason: Record<string, number>;
}

export function summarize(results: readonly SmokeResult[]): SmokeSummary {
    const byReason: Record<string, number> = {};
    let freezes = 0;
    for (const r of results) {
        byReason[r.reason] = (byReason[r.reason] ?? 0) + 1;
        if (isFreeze(r.reason)) freezes += 1;
    }
    return { games: results.length, freezes, byReason };
}

/** The receipt's closing block — the line a PR quotes. */
export function smokeVerdict(
    summary: SmokeSummary,
    iterations: number,
    baseSeed: number
): string {
    const spread = Object.keys(summary.byReason)
        .sort()
        .map((k) => `${k}=${summary.byReason[k]}`)
        .join(", ");
    const verdict =
        summary.freezes === 0
            ? `PASS — ${summary.games} games, 0 freezes`
            : `FAIL — ${summary.freezes}/${summary.games} games ended on a harness guard`;
    return (
        `${verdict}\n` +
        `outcomes: ${spread}\n` +
        `budget: iterations=${iterations}, baseSeed=${baseSeed} (deterministic)`
    );
}
