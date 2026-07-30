// Calibration fit unit tests (issue #1929, map #1892 step 3).
//
// Plain application-suite test on purpose: scripts/lib/ladder/fit.ts is pure
// math with no engine imports, so it runs in the app suite and is picked up by
// check:guards (scripts/__tests__ is part of the light pre-PR gate).

import { describe, expect, it } from "vitest";

import {
    calibrationTable,
    extractCalibrationSamples,
    fitLogisticSlope,
    type CalibrationSample,
} from "../lib/ladder/fit";
import {
    buildHeader,
    type LadderGameRecord,
    type LadderRunHeader,
} from "../lib/ladder/plan";

const PAIRINGS = [{ deckA: "a", deckB: "b", dynamics: ["x"] }];

function makeRecord(
    over: Partial<LadderGameRecord> & Pick<LadderGameRecord, "gameIndex">
): LadderGameRecord {
    return {
        kind: "game",
        pairingIndex: 0,
        seedIndex: 0,
        orientation: 0,
        deckSeat0: "a",
        deckSeat1: "b",
        seed: 1,
        candidateSeat: "S1",
        winnerSeat: "S0",
        candidateWon: false,
        reason: "life",
        turns: 10,
        plies: 100,
        ms: 1,
        marginSamples: [{ turn: 1, margin: 100 }],
        ...over,
    };
}

/** Deterministic LCG so synthetic corpora are reproducible without
 *  Math.random (bit-identical fit assertions depend on it). */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

/** Synthetic corpus drawn from a KNOWN logistic P(win) = σ(k·m). */
function syntheticCorpus(
    k: number,
    n: number,
    seed: number
): CalibrationSample[] {
    const rnd = lcg(seed);
    const out: CalibrationSample[] = [];
    for (let i = 0; i < n; i++) {
        const margin = (rnd() - 0.5) * 3000;
        const p = 1 / (1 + Math.exp(-k * margin));
        out.push({ margin, win: rnd() < p ? 1 : 0, turn: 1 + (i % 20) });
    }
    return out;
}

describe("extractCalibrationSamples (issue #1929)", () => {
    const nullHeader: LadderRunHeader = buildHeader(
        "smoke",
        1,
        null,
        400,
        PAIRINGS
    );
    const variantHeader: LadderRunHeader = buildHeader(
        "smoke",
        1,
        "reward-calibrated",
        400,
        PAIRINGS
    );

    it("labels samples with S0's outcome", () => {
        const recs = [
            makeRecord({ gameIndex: 0, winnerSeat: "S0" }),
            makeRecord({
                gameIndex: 2,
                seedIndex: 1,
                winnerSeat: "S1",
                candidateWon: true,
                marginSamples: [{ turn: 1, margin: -50 }],
            }),
        ];
        const s = extractCalibrationSamples(nullHeader, recs);
        expect(s).toEqual([
            { margin: 100, win: 1, turn: 1 },
            { margin: -50, win: 0, turn: 1 },
        ]);
    });

    it("drops orientation 1 in a NULL run (duplicate game) but keeps it in a variant run", () => {
        const recs = [
            makeRecord({ gameIndex: 0, orientation: 0 }),
            makeRecord({ gameIndex: 1, orientation: 1, candidateSeat: "S0" }),
        ];
        expect(extractCalibrationSamples(nullHeader, recs)).toHaveLength(1);
        expect(extractCalibrationSamples(variantHeader, recs)).toHaveLength(2);
    });

    it("drops guard-stop games (no outcome label)", () => {
        const recs = [
            makeRecord({
                gameIndex: 0,
                winnerSeat: null,
                candidateWon: null,
                reason: "stall",
            }),
        ];
        expect(extractCalibrationSamples(nullHeader, recs)).toHaveLength(0);
    });

    it("tolerates pre-#1929 records with no marginSamples field", () => {
        const rec = makeRecord({ gameIndex: 0 });
        delete rec.marginSamples;
        expect(extractCalibrationSamples(nullHeader, [rec])).toHaveLength(0);
    });
});

describe("fitLogisticSlope (issue #1929)", () => {
    it("recovers a known slope from a synthetic corpus", () => {
        const K_TRUE = 2e-3;
        const fit = fitLogisticSlope(syntheticCorpus(K_TRUE, 4000, 7));
        expect(fit.k).toBeGreaterThan(K_TRUE * 0.85);
        expect(fit.k).toBeLessThan(K_TRUE * 1.15);
        expect(fit.logLoss).toBeGreaterThan(0);
    });

    it("is bit-deterministic: same corpus, identical slope", () => {
        const corpus = syntheticCorpus(1e-3, 500, 3);
        expect(fitLogisticSlope(corpus).k).toBe(fitLogisticSlope(corpus).k);
    });

    it("is invariant under a global perspective flip (symmetric augmentation)", () => {
        const corpus = syntheticCorpus(1.5e-3, 800, 11);
        const flipped = corpus.map((s) => ({
            ...s,
            margin: -s.margin,
            win: (1 - s.win) as 0 | 1,
        }));
        expect(fitLogisticSlope(flipped).k).toBe(fitLogisticSlope(corpus).k);
    });

    it("throws on an empty corpus rather than emitting a fake constant", () => {
        expect(() => fitLogisticSlope([])).toThrow(/empty/);
    });
});

describe("calibrationTable (issue #1929)", () => {
    it("bins the corpus and reports empirical vs fitted rates", () => {
        const corpus = syntheticCorpus(2e-3, 3000, 5);
        const fit = fitLogisticSlope(corpus);
        const edges = [-Infinity, -500, 0, 500, Infinity];
        const table = calibrationTable(corpus, fit.k, edges);
        expect(table).toHaveLength(4);
        expect(table.reduce((a, b) => a + b.n, 0)).toBe(corpus.length);
        // Fitted probabilities must rise with the margin band.
        for (let i = 1; i < table.length; i++) {
            expect(table[i].fitted).toBeGreaterThan(table[i - 1].fitted);
        }
        // On a well-specified synthetic corpus the empirical rate tracks the
        // fitted one in every populated band.
        for (const b of table) {
            expect(Math.abs(b.empirical - b.fitted)).toBeLessThan(0.1);
        }
    });

    it("reports an empty band as n=0 with NaN rates, never a fake 0%", () => {
        const table = calibrationTable(
            [{ margin: 10, win: 1, turn: 1 }],
            1e-3,
            [-Infinity, 0, Infinity]
        );
        expect(table[0].n).toBe(0);
        expect(Number.isNaN(table[0].empirical)).toBe(true);
        expect(table[1].n).toBe(1);
    });
});
