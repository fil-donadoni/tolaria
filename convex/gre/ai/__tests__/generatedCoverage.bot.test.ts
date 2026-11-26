// The Census gate's arithmetic (issue #10857, ADR 0186): blind, contradictory
// and addressable pairs under the current vector and under current +
// generated, and the registered pass rule. Hand-built pairs, so each count is
// read off a corpus whose answer is known; the runner over the real fit side
// is `blade/__tests__/verdict-coverage.spec.ts`.

import { describe, expect, it } from "vitest";
import type { EvalPair } from "../verdicts/evalPairs";
import {
    EVAL_TERM_KEYS,
    FITTABLE_WEIGHT_KEYS,
    type FittableWeightKey,
} from "../verdicts/features";
import {
    formatGeneratedCoverage,
    generatedCoverage,
    type GeneratedPairReading,
} from "../verdicts/generatedCoverage";
import { contradictoryCouples, isBlindPair } from "../verdicts/report";
import type { VerdictReport } from "../verdicts/report";

const LAND = '{"kind":"play-land"}';
const PASS = '{"kind":"pass"}';

/** A violated pair (delta 0) with `basis` on the first fittable key. */
function pair(id: string, basisValue: number, key = LAND): EvalPair {
    const basis = Object.fromEntries(
        FITTABLE_WEIGHT_KEYS.map((k) => [k, 0])
    ) as Record<FittableWeightKey, number>;
    basis[FITTABLE_WEIGHT_KEYS[0]] = basisValue;
    const terms = Object.fromEntries(
        EVAL_TERM_KEYS.map((k) => [k, 0])
    ) as EvalPair["terms"];
    return {
        verdictId: id,
        kind: "right",
        rightIndex: 0,
        otherIndex: 1,
        right: { key, description: `right of ${id}` },
        other: { key: PASS, description: `other of ${id}` },
        terms,
        basis,
        fittableDelta: 0,
        delta: 0,
    };
}

/** The report `collectVerdictReport` would classify `pairs` into. */
function reportOf(pairs: EvalPair[]): VerdictReport {
    return {
        verdicts: pairs.length,
        rows: [],
        pairs,
        satisfied: [],
        violated: pairs,
        contradictions: contradictoryCouples(pairs),
        timing: [],
        contradictionsWithTiming: 0,
        blind: pairs.filter(isBlindPair),
        gaps: [],
        errors: [],
        incomplete: [],
    };
}

const SAME: GeneratedPairReading = { difference: [], vacuous: false };
const differs = (column: string, count: number): GeneratedPairReading => ({
    difference: [[column, count]],
    vacuous: false,
});

function readings(
    entries: [EvalPair, GeneratedPairReading][]
): (p: EvalPair) => GeneratedPairReading {
    const map = new Map(entries);
    return (p) => map.get(p) ?? SAME;
}

describe("generated vector census gate (issue #10857, ADR 0186)", () => {
    it("with no generated difference anywhere, current + generated counts exactly what current counts", () => {
        const pairs = [pair("a", 0), pair("b", 1), pair("c", -1), pair("d", 2)];
        const coverage = generatedCoverage(reportOf(pairs), () => SAME);
        expect(coverage.totals.current).toEqual({
            blind: 1,
            contradictory: 3,
            addressable: 0,
        });
        expect(coverage.totals.combined).toEqual(coverage.totals.current);
        expect(coverage.rule).toEqual({
            nonVacuousBlind: 1,
            separated: 0,
            required: 1,
            pass: false,
        });
        expect(coverage.stillBlind.map((p) => p.verdictId)).toEqual(["a"]);
    });

    it("a blind pair the generated vector tells apart leaves blind and counts as separated", () => {
        const a = pair("a", 0);
        const b = pair("b", 0);
        const coverage = generatedCoverage(
            reportOf([a, b]),
            readings([[a, differs("cards.graveyard.self", 1)]])
        );
        expect(coverage.totals.current.blind).toBe(2);
        expect(coverage.totals.combined).toEqual({
            blind: 1,
            contradictory: 0,
            addressable: 1,
        });
        // 1 of 2: half, rounded up, is 1 — the rule passes on the boundary.
        expect(coverage.rule).toEqual({
            nonVacuousBlind: 2,
            separated: 1,
            required: 1,
            pass: true,
        });
        expect(coverage.stillBlind.map((p) => p.verdictId)).toEqual(["b"]);
    });

    it("fails one short of half the non-vacuous blind pairs", () => {
        const [a, b, c] = [pair("a", 0), pair("b", 0), pair("c", 0)];
        const coverage = generatedCoverage(
            reportOf([a, b, c]),
            readings([[a, differs("cards.hand.self", 1)]])
        );
        expect(coverage.rule).toEqual({
            nonVacuousBlind: 3,
            separated: 1,
            required: 2,
            pass: false,
        });
        expect(formatGeneratedCoverage(coverage)).toContain("1 ≥ 2 of 3: FAIL");
    });

    it("a vacuous blind pair sits outside the denominator, separated or not", () => {
        const [a, b] = [pair("a", 0), pair("b", 0)];
        const coverage = generatedCoverage(
            reportOf([a, b]),
            readings([
                [a, { difference: [["cards.hand.self", 1]], vacuous: true }],
                [b, differs("cards.hand.self", 1)],
            ])
        );
        expect(coverage.totals.vacuousBlind).toBe(1);
        expect(coverage.rule).toEqual({
            nonVacuousBlind: 1,
            separated: 1,
            required: 1,
            pass: true,
        });
    });

    it("two pairs blind today whose generated differences are exact negatives become a contradictory couple", () => {
        const [a, b] = [pair("a", 0), pair("b", 0)];
        const coverage = generatedCoverage(
            reportOf([a, b]),
            readings([
                [a, differs("cards.hand.self", 2)],
                [b, differs("cards.hand.self", -1)],
            ])
        );
        expect(coverage.totals.combined).toEqual({
            blind: 0,
            contradictory: 2,
            addressable: 0,
        });
        // Separated all the same: the vectors differ, which is the rule's
        // question; whether a weight can then order both is the next one.
        expect(coverage.rule.separated).toBe(2);
    });

    it("a couple contradictory today stops being one when its generated halves are not anti-parallel", () => {
        const [a, b] = [pair("a", 1), pair("b", -1)];
        const coverage = generatedCoverage(
            reportOf([a, b]),
            readings([[a, differs("cards.hand.self", 1)]])
        );
        expect(coverage.totals.current.contradictory).toBe(2);
        expect(coverage.totals.combined).toEqual({
            blind: 0,
            contradictory: 0,
            addressable: 2,
        });
    });

    it("counts per decision class, in census order", () => {
        const land = pair("land", 0);
        const pass = pair("pass", 0, PASS);
        const coverage = generatedCoverage(
            reportOf([pass, land]),
            readings([[land, differs("cards.hand.self", 1)]])
        );
        expect(
            coverage.rows.map((r) => [r.class, r.separated, r.combined.blind])
        ).toEqual([
            ["land-drop", 1, 0],
            ["pass", 0, 1],
        ]);
    });
});
