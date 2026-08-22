import { describe, it, expect } from "vitest";
import {
    wilson,
    eloDelta,
    computeVerdict,
    summarizeRun,
    formatVerdictBlock,
} from "../lib/ladder/verdict";
import { buildHeader, type LadderGameRecord } from "../lib/ladder/plan";
import type { LadderPairing } from "../lib/ladder/pairings";

/**
 * Ladder verdict engine — the mechanical rules of decision #1895 §4 (issue
 * #1924). The verdict is arithmetic on Wilson 95% CIs; these tests pin the
 * arithmetic and each of the three rules so a strength decision can never
 * drift with a refactor.
 */

const PAIRINGS: LadderPairing[] = [
    { deckA: "a", deckB: "b", dynamics: ["x"] },
    { deckA: "c", deckB: "d", dynamics: ["y"] },
];

function rec(
    pairingIndex: number,
    candidateWon: boolean | null,
    gameIndex = 0
): LadderGameRecord {
    return {
        kind: "game",
        gameIndex,
        pairingIndex,
        seedIndex: 0,
        orientation: 0,
        deckSeat0: "a",
        deckSeat1: "b",
        seed: 1,
        candidateSeat: "S1",
        winnerSeat: candidateWon === null ? null : candidateWon ? "S1" : "S0",
        candidateWon,
        reason: candidateWon === null ? "stall" : "life",
        turns: 8,
        plies: 90,
        ms: 5,
    };
}

describe("Wilson 95% interval", () => {
    it("matches the textbook value for 8/10", () => {
        const ci = wilson(8, 10);
        expect(ci.rate).toBeCloseTo(0.8, 10);
        expect(ci.lo).toBeCloseTo(0.49, 2);
        expect(ci.hi).toBeCloseTo(0.943, 2);
    });

    it("is symmetric around 0.5 for a 50% sample", () => {
        const ci = wilson(50, 100);
        expect(ci.lo + ci.hi).toBeCloseTo(1, 10);
        expect(ci.lo).toBeGreaterThan(0.4);
        expect(ci.hi).toBeLessThan(0.6);
    });

    it("stays within [0,1] at the extremes and widens as n shrinks", () => {
        expect(wilson(3, 3).hi).toBeLessThanOrEqual(1);
        expect(wilson(0, 3).lo).toBeGreaterThanOrEqual(0);
        expect(wilson(8, 10).hi - wilson(8, 10).lo).toBeGreaterThan(
            wilson(80, 100).hi - wilson(80, 100).lo
        );
    });

    it("degrades safely on an empty sample: [0,1], rate 0.5", () => {
        expect(wilson(0, 0)).toEqual({ rate: 0.5, lo: 0, hi: 1, n: 0 });
    });
});

describe("Elo delta (informational)", () => {
    it("is 0 at 50%, positive above, negative below, finite at 100%", () => {
        expect(eloDelta(0.5)).toBeCloseTo(0, 10);
        expect(eloDelta(0.6)).toBeGreaterThan(0);
        expect(eloDelta(0.4)).toBeLessThan(0);
        expect(Number.isFinite(eloDelta(1))).toBe(true);
    });
});

describe("verdict rules (decision #1895 §4)", () => {
    const above = { rate: 0.6, lo: 0.52, hi: 0.68, n: 150 };
    const below = { rate: 0.4, lo: 0.32, hi: 0.48, n: 150 };
    const straddle = { rate: 0.52, lo: 0.44, hi: 0.6, n: 150 };

    it("IMPROVEMENT: aggregate entirely above 50%, no matchup entirely below", () => {
        expect(computeVerdict(above, [above, straddle])).toBe("IMPROVEMENT");
    });

    it("a single matchup entirely below 50% blocks IMPROVEMENT", () => {
        expect(computeVerdict(above, [above, below])).toBe("INCONCLUSIVE");
    });

    it("REGRESSION: aggregate entirely below 50%", () => {
        expect(computeVerdict(below, [below, straddle])).toBe("REGRESSION");
    });

    it("INCONCLUSIVE: aggregate straddles 50%", () => {
        expect(computeVerdict(straddle, [above, below])).toBe("INCONCLUSIVE");
    });
});

describe("summarizeRun", () => {
    it("folds records per matchup, excluding guard stops from win-rates", () => {
        const records = [
            rec(0, true, 0),
            rec(0, true, 1),
            rec(0, false, 2),
            rec(0, null, 3), // guard stop — never a win or a loss
            rec(1, false, 4),
        ];
        const s = summarizeRun(records, PAIRINGS);
        expect(s.games).toBe(5);
        expect(s.decisive).toBe(4);
        expect(s.guardStops).toBe(1);
        expect(s.matchups[0].wins).toBe(2);
        expect(s.matchups[0].losses).toBe(1);
        expect(s.matchups[0].guardStops).toBe(1);
        expect(s.matchups[1].decisive).toBe(1);
        expect(s.aggregate.rate).toBeCloseTo(0.5, 10);
        expect(s.verdict).toBe("INCONCLUSIVE");
    });
});

describe("summarizeRun is order-independent (issue #2681)", () => {
    // Records referencing only pairing 0 and pairing 1 out of a 3-row
    // registry — pairing 2 is never played (the parallel-worker/filtered-run
    // shape: workers finish in whatever order, and a filtered run only ever
    // produces records for the SELECTED registry rows).
    const THREE_PAIRINGS: LadderPairing[] = [
        ...PAIRINGS,
        { deckA: "e", deckB: "f", dynamics: ["z"] },
    ];
    const records = [
        rec(0, true, 0),
        rec(0, false, 1),
        rec(1, true, 2),
        rec(1, null, 3),
        rec(0, true, 4),
    ];

    it("never reports a phantom 0/0 matchup for a pairing with zero records", () => {
        const s = summarizeRun(records, THREE_PAIRINGS);
        expect(s.matchups.map((m) => m.pairingIndex)).toEqual([0, 1]);
        expect(s.matchups.some((m) => m.pairingIndex === 2)).toBe(false);
    });

    it("shuffling the record array yields an identical summary", () => {
        const original = summarizeRun(records, THREE_PAIRINGS);
        const shuffled = [...records].reverse();
        const shuffledSummary = summarizeRun(shuffled, THREE_PAIRINGS);
        expect(shuffledSummary).toEqual(original);

        // A second, differently-ordered permutation (interleaved, the shape a
        // real multi-worker completion order would produce).
        const interleaved = [
            records[2],
            records[0],
            records[4],
            records[3],
            records[1],
        ];
        expect(summarizeRun(interleaved, THREE_PAIRINGS)).toEqual(original);
    });
});

describe("formatVerdictBlock", () => {
    it("emits the paste-ready PR block with verdict, config and per-matchup CIs", () => {
        const header = buildHeader("smoke", 9, "my-variant", 400, PAIRINGS);
        const block = formatVerdictBlock(
            summarizeRun([rec(0, true), rec(1, false)], PAIRINGS),
            header
        );
        expect(block).toContain("Ladder verdict: **INCONCLUSIVE**");
        expect(block).toContain("`my-variant`");
        expect(block).toContain("baseSeed `9`");
        expect(block).toContain("| a vs b |");
        expect(block).toContain("| c vs d |");
    });
});
