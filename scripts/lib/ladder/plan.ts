// Ladder run plan + JSONL record model (issue #1924, decision #1895 §2/§3).
//
// Pure module: no fs, no clock, no engine imports — everything here is
// derivable arithmetic, so the determinism contract is testable in the
// application suite. The contract (decision #1895 §2):
//
//   * fixed ITERATION budget (never timeMs);
//   * per-game seeds DERIVED from the run's baseSeed — pairing p, seed-index k
//     uses `baseSeed + p * seedsPerPairing + k`;
//   * PAIRED games: the two orientations of a pair share that seed, so both
//     agents play the exact same shuffles from both sides (fishtest book-exit
//     style) and comparison variance roughly halves;
//   * same command + same baseSeed + same tier → bit-identical run. A fresh
//     sample = change baseSeed.
//
// Orientation semantics: the initial state of a pair is IDENTICAL across its
// two games (same seating, same seed ⇒ same shuffles); what swaps is which
// AGENT drives which seat. Seat S0 is always on the play. Deck seating
// alternates by seed-index parity so both decks get on-the-play coverage.

import type { LadderPairing } from "./pairings";
import { selectPairingIndices, type LadderFilterSpec } from "./filter";

export type LadderTier = "smoke" | "decision";

/** Seeds (= game pairs) per pairing row, per tier (decision #1895 §6). */
export const TIER_SEEDS: Record<LadderTier, number> = {
    smoke: 4, // 6 pairings × 2 orientations × 4 seeds = 48 games ≈ 1h
    decision: 20, // 6 × 2 × 20 = 240 games ≈ 4–5h
};

/** The fixed production search budget — iterations only, never wall-clock. */
export const LADDER_ITERATIONS = 400;

export type SeatId = "S0" | "S1";

export type LadderGamePlan = {
    gameIndex: number;
    pairingIndex: number;
    seedIndex: number;
    /** 0 → control drives S0 (candidate S1); 1 → candidate drives S0. */
    orientation: 0 | 1;
    deckSeat0: string;
    deckSeat1: string;
    /** Derived game seed — shared by both orientations of the pair. */
    seed: number;
    candidateSeat: SeatId;
};

/** First line of every run file — the run's identity. Resume validates against
 *  it so a file can never silently continue under a different config. */
export type LadderRunHeader = {
    kind: "header";
    version: 1;
    tier: LadderTier;
    baseSeed: number;
    /** Candidate variant name, or null for the control-vs-control null run. */
    variant: string | null;
    iterations: number;
    /** Pairing-subset filter (issue #2681), or null for the full registry.
     *  Resume validates this against the registry the same way it validates
     *  `pairings` — a run under a different filter is a DIFFERENT experiment. */
    filter: LadderFilterSpec | null;
    totalGames: number;
    pairings: { deckA: string; deckB: string }[];
};

/** One line per completed game, appended as soon as the game ends — a crash
 *  keeps the partial corpus and resume is exact (seeds are derived). */
export type LadderGameRecord = {
    kind: "game";
    gameIndex: number;
    pairingIndex: number;
    seedIndex: number;
    orientation: 0 | 1;
    deckSeat0: string;
    deckSeat1: string;
    seed: number;
    candidateSeat: SeatId;
    winnerSeat: SeatId | null;
    /** null = guard stop (stall / search-error / …), excluded from win-rates. */
    candidateWon: boolean | null;
    reason: string;
    turns: number;
    plies: number;
    ms: number;
};

/** Expand the pairing registry into the full deterministic game list. */
export function buildGamePlan(
    pairings: LadderPairing[],
    seedsPerPairing: number,
    baseSeed: number
): LadderGamePlan[] {
    const plan: LadderGamePlan[] = [];
    for (let p = 0; p < pairings.length; p++) {
        for (let k = 0; k < seedsPerPairing; k++) {
            const seed = baseSeed + p * seedsPerPairing + k;
            // Alternate deck seating by seed parity so each deck plays on the
            // play; within a pair the seating is fixed and only agents swap.
            const flip = k % 2 === 1;
            const deckSeat0 = flip ? pairings[p].deckB : pairings[p].deckA;
            const deckSeat1 = flip ? pairings[p].deckA : pairings[p].deckB;
            for (const orientation of [0, 1] as const) {
                plan.push({
                    gameIndex: plan.length,
                    pairingIndex: p,
                    seedIndex: k,
                    orientation,
                    deckSeat0,
                    deckSeat1,
                    seed,
                    candidateSeat: orientation === 0 ? "S1" : "S0",
                });
            }
        }
    }
    return plan;
}

export function buildHeader(
    tier: LadderTier,
    baseSeed: number,
    variant: string | null,
    iterations: number,
    pairings: LadderPairing[],
    filter: LadderFilterSpec | null = null
): LadderRunHeader {
    // totalGames reflects the FILTERED game count (what this run will
    // actually play), while `pairings` below always records the full
    // registry — headerMismatches still needs it to detect a registry
    // change independent of the filter (issue #2681).
    const selected = selectPairingIndices(pairings, filter).size;
    return {
        kind: "header",
        version: 1,
        tier,
        baseSeed,
        variant,
        iterations,
        filter,
        totalGames: selected * TIER_SEEDS[tier] * 2,
        pairings: pairings.map(({ deckA, deckB }) => ({ deckA, deckB })),
    };
}

/** Parse a run file's lines into header + game records. Throws on a file that
 *  does not start with a v1 header; skips a trailing torn line (a crash mid-
 *  append) rather than failing the whole resume. */
export function parseRunFile(lines: string[]): {
    header: LadderRunHeader;
    records: LadderGameRecord[];
} {
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    if (nonEmpty.length === 0) throw new Error("empty run file");
    const header = JSON.parse(nonEmpty[0]) as LadderRunHeader;
    if (header.kind !== "header" || header.version !== 1) {
        throw new Error("run file does not start with a v1 ladder header");
    }
    const records: LadderGameRecord[] = [];
    for (let i = 1; i < nonEmpty.length; i++) {
        let parsed: LadderGameRecord;
        try {
            parsed = JSON.parse(nonEmpty[i]) as LadderGameRecord;
        } catch {
            if (i === nonEmpty.length - 1) continue; // torn tail from a crash
            throw new Error(`malformed record at line ${i + 1}`);
        }
        if (parsed.kind === "game") records.push(parsed);
    }
    return { records, header };
}

/** Config mismatches that make a resume invalid — a resumed run must be the
 *  SAME experiment, not a lookalike. Empty array = safe to resume. */
export function headerMismatches(
    header: LadderRunHeader,
    expected: LadderRunHeader
): string[] {
    const out: string[] = [];
    if (header.tier !== expected.tier)
        out.push(`tier: file=${header.tier} run=${expected.tier}`);
    if (header.baseSeed !== expected.baseSeed)
        out.push(`baseSeed: file=${header.baseSeed} run=${expected.baseSeed}`);
    if ((header.variant ?? null) !== (expected.variant ?? null))
        out.push(`variant: file=${header.variant} run=${expected.variant}`);
    if (header.iterations !== expected.iterations)
        out.push(
            `iterations: file=${header.iterations} run=${expected.iterations}`
        );
    if (JSON.stringify(header.pairings) !== JSON.stringify(expected.pairings))
        out.push("pairings: registry changed since the file was started");
    if (header.totalGames !== expected.totalGames)
        out.push(
            `totalGames: file=${header.totalGames} run=${expected.totalGames}`
        );
    if (
        JSON.stringify(header.filter ?? null) !==
        JSON.stringify(expected.filter ?? null)
    )
        out.push(
            `filter: file=${JSON.stringify(header.filter ?? null)} run=${JSON.stringify(expected.filter ?? null)}`
        );
    return out;
}

/** The plan filtered down to the rows a `--pairings`/`--dynamics` filter
 *  selected — preserving every field (gameIndex, seed, pairingIndex, …)
 *  UNTOUCHED. This is the whole identity fix of issue #2681: `buildGamePlan`
 *  always runs over the full registry (so seeds and gameIndex are derived
 *  exactly as an unfiltered run would derive them), and filtering happens
 *  strictly AFTER, as a plain array filter — so a filtered run's game
 *  records are element-wise identical to the matching rows of an unfiltered
 *  run, never renumbered. */
export function filterGamePlan(
    plan: LadderGamePlan[],
    allowedPairingIndices: Set<number>
): LadderGamePlan[] {
    return plan.filter((g) => allowedPairingIndices.has(g.pairingIndex));
}

/** The plan entries not yet present in `records` — the exact games a resumed
 *  run still owes, in order. */
export function remainingGames(
    plan: LadderGamePlan[],
    records: LadderGameRecord[]
): LadderGamePlan[] {
    const done = new Set(records.map((r) => r.gameIndex));
    return plan.filter((g) => !done.has(g.gameIndex));
}
