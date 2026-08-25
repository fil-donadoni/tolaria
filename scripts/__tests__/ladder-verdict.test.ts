import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
    wilson,
    eloDelta,
    computeVerdict,
    summarizeRun,
    formatVerdictBlock,
    pairedAggregate,
} from "../lib/ladder/verdict";
import {
    buildHeader,
    type LadderGameRecord,
    type SeatId,
} from "../lib/ladder/plan";
import type { LadderPairing } from "../lib/ladder/pairings";

/**
 * Ladder verdict engine — the mechanical rules of decision #1895 §4 (issue
 * #1924), extended with the PAIRED (McNemar-style) aggregate of issue #2779.
 * The verdict is arithmetic on 95% CIs; these tests pin the arithmetic and
 * each rule so a strength decision can never drift with a refactor.
 */

const PAIRINGS: LadderPairing[] = [
    { deckA: "a", deckB: "b", dynamics: ["x"] },
    { deckA: "c", deckB: "d", dynamics: ["y"] },
];

function rec(
    pairingIndex: number,
    candidateWon: boolean | null,
    gameIndex = 0,
    opts: { seedIndex?: number; orientation?: 0 | 1 } = {}
): LadderGameRecord {
    const orientation = opts.orientation ?? 0;
    const candidateSeat: SeatId = orientation === 0 ? "S1" : "S0";
    // winnerSeat follows candidateSeat when the candidate won, the OTHER
    // seat when it lost — never invert this without also inverting
    // candidateWon, or the S0-seat-rate fixtures silently go wrong.
    const winnerSeat: SeatId | null =
        candidateWon === null
            ? null
            : candidateWon
              ? candidateSeat
              : candidateSeat === "S0"
                ? "S1"
                : "S0";
    return {
        kind: "game",
        gameIndex,
        pairingIndex,
        seedIndex: opts.seedIndex ?? 0,
        orientation,
        deckSeat0: "a",
        deckSeat1: "b",
        seed: 1,
        candidateSeat,
        winnerSeat,
        candidateWon,
        reason: candidateWon === null ? "stall" : "life",
        turns: 8,
        plies: 90,
        ms: 5,
    };
}

/** Build one complete PAIR (both orientations of one seedIndex) with a given
 *  outcome shape: "for" = candidate sweeps both, "against" = candidate drops
 *  both, "split" = 1-1 (concordant, uninformative). */
function pair(
    pairingIndex: number,
    seedIndex: number,
    shape: "for" | "against" | "split",
    gameIndexStart: number
): LadderGameRecord[] {
    const o0Won = shape === "for" || (shape === "split" && seedIndex % 2 === 0);
    const o1Won = shape === "for" || (shape === "split" && seedIndex % 2 !== 0);
    return [
        rec(pairingIndex, o0Won, gameIndexStart, { seedIndex, orientation: 0 }),
        rec(pairingIndex, o1Won, gameIndexStart + 1, {
            seedIndex,
            orientation: 1,
        }),
    ];
}

/** Build a synthetic corpus of `concordant` 1-1 pairs plus `sweepsFor`
 *  candidate-sweep and `sweepsAgainst` control-sweep pairs, all on a single
 *  pairingIndex — the composition the acceptance criteria specify. */
function syntheticCorpus(
    concordant: number,
    sweepsFor: number,
    sweepsAgainst: number
): LadderGameRecord[] {
    const records: LadderGameRecord[] = [];
    let seedIndex = 0;
    let gi = 0;
    for (let i = 0; i < sweepsFor; i++, seedIndex++, gi += 2)
        records.push(...pair(0, seedIndex, "for", gi));
    for (let i = 0; i < sweepsAgainst; i++, seedIndex++, gi += 2)
        records.push(...pair(0, seedIndex, "against", gi));
    for (let i = 0; i < concordant; i++, seedIndex++, gi += 2)
        records.push(...pair(0, seedIndex, "split", gi));
    return records;
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

describe("pairedAggregate (issue #2779, McNemar's test over the ladder's own pairing design)", () => {
    it("counts a 2-0 sweep as sweepsFor and a 0-2 sweep as sweepsAgainst", () => {
        const records = [...pair(0, 0, "for", 0), ...pair(0, 1, "against", 2)];
        const p = pairedAggregate(records);
        expect(p.pairs).toBe(2);
        expect(p.sweepsFor).toBe(1);
        expect(p.sweepsAgainst).toBe(1);
        expect(p.discordant).toBe(2);
        expect(p.concordant).toBe(0);
        expect(p.excludedPairs).toBe(0);
    });

    it("counts a 1-1 split as concordant — zero weight on the SD", () => {
        const records = pair(0, 0, "split", 0);
        const p = pairedAggregate(records);
        expect(p.pairs).toBe(1);
        expect(p.concordant).toBe(1);
        expect(p.discordant).toBe(0);
        // rate stays exactly 0.5: a concordant pair moves neither numerator
        // nor the SD, so the interval collapses to a point at 50%.
        expect(p.rate).toBeCloseTo(0.5, 10);
        expect(p.lo).toBeCloseTo(0.5, 10);
        expect(p.hi).toBeCloseTo(0.5, 10);
    });

    it("excludes a pair whose partner is a guard stop, reporting it separately", () => {
        const records = [
            rec(0, true, 0, { seedIndex: 0, orientation: 0 }),
            rec(0, null, 1, { seedIndex: 0, orientation: 1 }), // guard stop
            ...pair(0, 1, "for", 2),
        ];
        const p = pairedAggregate(records);
        expect(p.pairs).toBe(1);
        expect(p.excludedPairs).toBe(1);
        expect(p.sweepsFor).toBe(1);
    });

    it("excludes a pair whose partner orientation was simply never played", () => {
        const records = [rec(0, true, 0, { seedIndex: 0, orientation: 0 })];
        const p = pairedAggregate(records);
        expect(p.pairs).toBe(0);
        expect(p.excludedPairs).toBe(1);
        // degrades safely, same convention as wilson(0, 0).
        expect(p).toMatchObject({ rate: 0.5, lo: 0, hi: 1 });
    });

    it("degrades safely with zero records", () => {
        const p = pairedAggregate([]);
        expect(p).toMatchObject({
            rate: 0.5,
            lo: 0,
            hi: 1,
            pairs: 0,
            excludedPairs: 0,
        });
    });

    describe("reproduces the placebo corpus: ±2.00pp paired vs ≈±3.75pp unpaired (issue #2779)", () => {
        // The real 2026-08-24 s1-decision-placebo run is untracked (gitignored
        // ladder-runs/, confirmed via `git ls-files` — the process map's claim
        // that the file is tracked does not hold), so this is a byte-for-byte
        // copy checked in as a test fixture instead (scripts/__tests__/fixtures),
        // preserving the exact 292 concordant / 30 sweepsFor / 18 sweepsAgainst
        // split the acceptance criterion pins.
        const raw = readFileSync(
            join(__dirname, "fixtures/ladder-placebo.jsonl"),
            "utf8"
        )
            .trim()
            .split("\n");
        const header = JSON.parse(raw[0]);
        const records: LadderGameRecord[] = raw
            .slice(1)
            .map((l) => JSON.parse(l));

        it("fixture matches the split the issue measured: 340 pairs, 292/30/18", () => {
            const p = pairedAggregate(records);
            expect(p.pairs).toBe(340);
            expect(p.concordant).toBe(292);
            expect(p.sweepsFor).toBe(30);
            expect(p.sweepsAgainst).toBe(18);
            expect(p.excludedPairs).toBe(0);
            expect(records.length).toBe(680);
            expect(records.every((r) => r.candidateWon !== null)).toBe(true);
        });

        it("paired half-width is 2.00pp and unpaired is ≈3.75pp — ~1.87x tighter", () => {
            const summary = summarizeRun(records, [], { orientations: 2 });
            const pairedHalfPp =
                (summary.paired.rate - summary.paired.lo) * 100;
            const unpairedHalfPp =
                (summary.aggregate.rate - summary.aggregate.lo) * 100;

            expect(pairedHalfPp).toBeCloseTo(2.0, 1);
            expect(unpairedHalfPp).toBeCloseTo(3.75, 1);
            expect(unpairedHalfPp / pairedHalfPp).toBeGreaterThan(1.8);
            expect(unpairedHalfPp / pairedHalfPp).toBeLessThan(2.0);

            // same central estimate either way — only the CI width differs,
            // which is exactly the point: the pairing buys precision, not a
            // different answer.
            expect(summary.paired.rate).toBeCloseTo(summary.aggregate.rate, 10);
        });

        it("the header threads orientations through unchanged (sanity)", () => {
            expect(header.orientations).toBe(2);
        });
    });
});

describe("computeVerdict: PAIRED aggregate gives IMPROVEMENT where unpaired stays INCONCLUSIVE (issue #2779 power gain)", () => {
    // Same discordant total (48) as the placebo corpus, but far more lopsided
    // (40 for / 8 against) and diluted by 1000 uninformative concordant pairs
    // — realistic ladder scale. The paired statistic ignores the concordant
    // pairs entirely (only discordant pairs feed its SD) and clears 50%; the
    // unpaired Wilson interval, diluted by 2000 extra 50/50 games, does not.
    const records = syntheticCorpus(1000, 40, 8);

    it("paired verdict: IMPROVEMENT", () => {
        const summary = summarizeRun(records, [{ deckA: "a", deckB: "b" }], {
            orientations: 2,
        });
        expect(summary.paired.pairs).toBe(1048);
        expect(summary.paired.lo).toBeGreaterThan(0.5);
        expect(summary.verdict).toBe("IMPROVEMENT");
    });

    it("the SAME corpus judged unpaired (pre-#2779 behaviour) stays INCONCLUSIVE", () => {
        const summary = summarizeRun(records, [{ deckA: "a", deckB: "b" }], {
            orientations: 2,
        });
        const unpairedVerdict = computeVerdict(
            summary.aggregate,
            summary.matchups.map((m) => m.ci)
        );
        expect(summary.aggregate.lo).toBeLessThan(0.5);
        expect(unpairedVerdict).toBe("INCONCLUSIVE");
    });
});

describe("orientations:1 corpus mode prints no candidate verdict (issue #2779)", () => {
    it("summarizeRun returns NO_VERDICT and a seat-rate reading, never IMPROVEMENT/REGRESSION", () => {
        // Only orientation 0 ever played — candidateSeat is S1 in every game,
        // so any "candidate" rate would just be the seat-S1 rate. S0 wins the
        // majority here (7/10) — a real seat edge, not a candidate result.
        const records: LadderGameRecord[] = [];
        for (let i = 0; i < 10; i++) {
            const s0Won = i < 7;
            records.push(rec(0, !s0Won, i, { seedIndex: i, orientation: 0 }));
        }
        const summary = summarizeRun(records, PAIRINGS, { orientations: 1 });
        expect(summary.verdict).toBe("NO_VERDICT");
        expect(summary.seatCI.rate).toBeCloseTo(0.7, 10);
        // orientations:1 never plays a second orientation, so pairedAggregate
        // finds zero complete pairs on its own — no special-casing needed.
        expect(summary.paired.pairs).toBe(0);
    });

    it("formatVerdictBlock prints the seat reading and the no-verdict line, not an aggregate", () => {
        const records: LadderGameRecord[] = [
            rec(0, false, 0, { seedIndex: 0, orientation: 0 }), // S0 won
        ];
        const header = buildHeader("smoke", 9, null, 400, PAIRINGS, null, 1);
        const summary = summarizeRun(records, PAIRINGS, header);
        const block = formatVerdictBlock(summary, header);
        expect(block).toContain(
            "no candidate verdict — corpus mode, single orientation"
        );
        expect(block).toContain("S0 win rate:");
        expect(block).not.toContain("IMPROVEMENT");
        expect(block).not.toContain("REGRESSION");
        expect(block).not.toContain("INCONCLUSIVE");
    });

    // Review finding #2802/2: the header lines above read as a seat
    // advantage, but the matchup TABLE below them used to stay unchanged
    // ("| matchup | candidate | win-rate [95% CI] |" with rows keyed off
    // candidateWon) — in corpus mode the candidate label sits on S1 in every
    // game, so those were per-matchup SEAT rates presented as candidate
    // results, the exact misreading NO_VERDICT exists to remove, just
    // relocated from the aggregate line into the table. This pins the
    // table's actual content, not merely the absence of the verdict words.
    it("the matchup table reads as a seat result, not a candidate result, in corpus mode", () => {
        const records: LadderGameRecord[] = [
            rec(0, false, 0, { seedIndex: 0, orientation: 0 }), // S0 won, candidate (S1) lost
        ];
        const header = buildHeader("smoke", 9, null, 400, PAIRINGS, null, 1);
        const summary = summarizeRun(records, PAIRINGS, header);
        const block = formatVerdictBlock(summary, header);
        // column is relabeled — never "candidate" when there is no
        // candidate reading to report.
        expect(block).toContain("| matchup | S0 seat | win-rate [95% CI] |");
        expect(block).not.toContain(
            "| matchup | candidate | win-rate [95% CI] |"
        );
        // the row reports the SEAT winner (S0 won this game): 1-0. Under the
        // old candidate-keyed rendering the same game would show 0-1 (the
        // candidate's loss) — the exact mislabeling this finding flags.
        expect(block).toContain("| a vs b | 1–0");
        expect(block).not.toContain("| a vs b | 0–1");
    });
});

describe("incomplete pairs fall back cleanly and are reported (issue #2779)", () => {
    it("a lone game with no partner orientation: paired.pairs=0, verdict falls back to unpaired", () => {
        const records = [rec(0, true, 0, { seedIndex: 0, orientation: 0 })];
        const summary = summarizeRun(records, PAIRINGS, { orientations: 2 });
        expect(summary.paired.pairs).toBe(0);
        expect(summary.paired.excludedPairs).toBe(1);
        // falls back to the unpaired Wilson aggregate for the decision — a
        // single decisive win gives a very wide interval that still
        // straddles 50%.
        expect(summary.verdict).toBe(
            computeVerdict(
                summary.aggregate,
                summary.matchups.map((m) => m.ci)
            )
        );
        expect(summary.verdict).toBe("INCONCLUSIVE");
    });

    // NOTE: the test above is a weak guard for the fallback itself — with a
    // single orphan half-pair, the degenerate paired interval (rate 0.5,
    // [0,1]) and the unpaired Wilson aggregate BOTH straddle 50% and BOTH
    // read INCONCLUSIVE, so it stays green even if `paired.pairs > 0 ?
    // paired : aggregate` at verdict.ts is replaced by bare `paired` (review
    // finding #2802/1, verified empirically: all 28 pre-existing tests
    // stayed green under that exact mutation). This test is the actual
    // guard: 30 orphan half-pairs, all losses, none paired — the fallback
    // and the bare-`paired` reading disagree on the VERDICT, not just the
    // interval, so a deleted fallback shows up as a wrong verdict.
    it("many orphan half-pairs, all losses: verdict comes from the unpaired fallback, not the degenerate paired interval (guards the fallback itself, review finding #2802/1)", () => {
        const records: LadderGameRecord[] = [];
        for (let i = 0; i < 30; i++) {
            records.push(rec(0, false, i, { seedIndex: i, orientation: 0 }));
        }
        const summary = summarizeRun(records, PAIRINGS, { orientations: 2 });
        expect(summary.paired.pairs).toBe(0);
        expect(summary.paired.excludedPairs).toBe(30);
        // the degenerate paired interval alone is [0, 1] — straddles 50% —
        // so a verdict computed from bare `paired` would read INCONCLUSIVE.
        // The unpaired Wilson aggregate over 30 straight losses clears
        // REGRESSION instead; the fallback must select IT.
        expect(summary.aggregate.hi).toBeLessThan(0.5);
        expect(summary.verdict).toBe(
            computeVerdict(
                summary.aggregate,
                summary.matchups.map((m) => m.ci)
            )
        );
        expect(summary.verdict).toBe("REGRESSION");
    });

    it("one incomplete pair alongside otherwise-complete pairs: excluded, not folded in, complete pairs still drive the verdict", () => {
        const records = [
            ...syntheticCorpus(0, 20, 0), // 20 clean sweeps-for pairs
            rec(0, true, 999, { seedIndex: 500, orientation: 0 }), // orphan half-pair
        ];
        const summary = summarizeRun(records, PAIRINGS, { orientations: 2 });
        expect(summary.paired.pairs).toBe(20);
        expect(summary.paired.excludedPairs).toBe(1);
        expect(summary.paired.sweepsFor).toBe(20);
        // the excluded pair is surfaced in the rendered block.
        const header = buildHeader("smoke", 9, "my-variant", 400, PAIRINGS);
        const block = formatVerdictBlock(summary, header);
        expect(block).toContain("1 excluded");
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
        const s = summarizeRun(records, PAIRINGS, { orientations: 2 });
        expect(s.games).toBe(5);
        expect(s.decisive).toBe(4);
        expect(s.guardStops).toBe(1);
        expect(s.matchups[0].wins).toBe(2);
        expect(s.matchups[0].losses).toBe(1);
        expect(s.matchups[0].guardStops).toBe(1);
        expect(s.matchups[1].decisive).toBe(1);
        expect(s.aggregate.rate).toBeCloseTo(0.5, 10);
        // all records share seedIndex 0/orientation 0 here (the `rec` default)
        // so pairedAggregate finds no complete pairs — verdict falls back to
        // the unpaired aggregate, which is what this test's expectation pins.
        expect(s.paired.pairs).toBe(0);
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
        const s = summarizeRun(records, THREE_PAIRINGS, { orientations: 2 });
        expect(s.matchups.map((m) => m.pairingIndex)).toEqual([0, 1]);
        expect(s.matchups.some((m) => m.pairingIndex === 2)).toBe(false);
    });

    it("shuffling the record array yields an identical summary", () => {
        const original = summarizeRun(records, THREE_PAIRINGS, {
            orientations: 2,
        });
        const shuffled = [...records].reverse();
        const shuffledSummary = summarizeRun(shuffled, THREE_PAIRINGS, {
            orientations: 2,
        });
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
        expect(
            summarizeRun(interleaved, THREE_PAIRINGS, { orientations: 2 })
        ).toEqual(original);
    });
});

describe("formatVerdictBlock", () => {
    it("emits the paste-ready PR block with verdict, config and per-matchup CIs", () => {
        const header = buildHeader("smoke", 9, "my-variant", 400, PAIRINGS);
        const block = formatVerdictBlock(
            summarizeRun([rec(0, true), rec(1, false)], PAIRINGS, header),
            header
        );
        expect(block).toContain("Ladder verdict: **INCONCLUSIVE**");
        expect(block).toContain("`my-variant`");
        expect(block).toContain("baseSeed `9`");
        expect(block).toContain("| a vs b |");
        expect(block).toContain("| c vs d |");
    });

    it("prints both paired and unpaired readings, marking which drove the verdict", () => {
        const header = buildHeader("smoke", 9, "my-variant", 400, PAIRINGS);
        const records = syntheticCorpus(5, 3, 0); // small corpus — only checks rendering, not a specific verdict value
        const summary = summarizeRun(records, PAIRINGS, header);
        const block = formatVerdictBlock(summary, header);
        expect(block).toContain("- paired:");
        expect(block).toContain("- unpaired:");
        expect(block).toContain("paired:");
        expect(
            block.split("\n").find((l) => l.startsWith("- paired:"))
        ).toMatch(/used for the verdict/);
    });
});
