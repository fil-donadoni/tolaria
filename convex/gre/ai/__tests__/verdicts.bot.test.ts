// Verdicts, Eval Pairs and the report (issue #3400, PRD #3397, ADR 0124).
//
// Every assertion here runs through the REAL builder, the REAL enumerator and
// the REAL 1-ply probe on a REAL registry position — a hand-built state or a
// hand-written feature vector would be asserting this file's own arithmetic
// rather than the bridge's (PRD #3397 testing decisions).
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/registry";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import {
    FITTABLE_WEIGHT_KEYS,
    collectVerdictReport,
    evalPairsOf,
    scoreBasis,
    verdictFromScenario,
    verdictsFromRegistry,
    type Verdict,
} from "../verdicts";

const STONE_RAIN_LABEL =
    "board-aware removal: casts Stone Rain on a land when there is nothing better to do";

function stoneRainVerdict(): Verdict {
    const scenario = BLADE_SCENARIOS.find((s) => s.label === STONE_RAIN_LABEL);
    expect(
        scenario,
        `registry entry "${STONE_RAIN_LABEL}" is gone`
    ).toBeDefined();
    const out = verdictFromScenario(scenario!);
    expect("verdict" in out ? "" : out.gap.detail).toBe("");
    return (out as { verdict: Verdict }).verdict;
}

describe("verdictsFromRegistry (issue #3400)", () => {
    const { verdicts, gaps } = verdictsFromRegistry();

    it("yields one `right` verdict per positive `moves` entry", () => {
        const movesEntries = BLADE_SCENARIOS.filter(
            (s) => s.expect.moves !== undefined
        );
        const right = verdicts.filter((v) => v.answer.kind === "right");
        const unlowered = gaps.filter((g) =>
            movesEntries.some((s) => s.label === g.label)
        );
        // The guard PRD #3397 asks for: the count of registry verdicts equals
        // the count of `moves` entries. Stated as a partition rather than a
        // bare number so a failure names WHICH entries fell out and why — and
        // the only admissible way out is `unconstraining`, a position whose
        // only legal line every decider already takes.
        expect(
            unlowered
                .filter((g) => g.reason !== "unconstraining")
                .map((g) => `${g.reason}: ${g.label} — ${g.detail}`)
        ).toEqual([]);
        expect(right.length + unlowered.length).toBe(movesEntries.length);
        expect(right.length).toBeGreaterThan(60);
    });

    it("reports `predicate` entries by label instead of skipping them", () => {
        const predicateEntries = BLADE_SCENARIOS.filter(
            (s) => s.expect.predicate !== undefined
        );
        expect(predicateEntries.length).toBeGreaterThan(0);
        const reported = gaps.filter((g) => g.reason === "predicate");
        expect(reported.map((g) => g.label).sort()).toEqual(
            predicateEntries.map((s) => s.label).sort()
        );
        // Never a verdict — a closure names no candidate.
        for (const entry of predicateEntries) {
            expect(
                verdicts.some((v) => v.id === `registry:${entry.label}`)
            ).toBe(false);
        }
    });

    it("turns a `forbidden` entry into the weaker forbidden constraint", () => {
        const forbiddenEntries = BLADE_SCENARIOS.filter(
            (s) => s.expect.forbidden !== undefined
        );
        expect(forbiddenEntries.length).toBeGreaterThan(0);
        const forbidden = verdicts.filter((v) => v.answer.kind === "forbidden");
        expect(forbidden.length).toBeGreaterThan(0);
        for (const verdict of forbidden) {
            const answer = verdict.answer;
            expect(
                answer.kind === "forbidden" && answer.forbiddenIndexes.length
            ).toBeGreaterThan(0);
        }
    });

    it("is deterministic — no clock, no seed of its own", () => {
        const again = verdictsFromRegistry(BLADE_SCENARIOS.slice(0, 12));
        expect(again).toEqual(
            verdictsFromRegistry(BLADE_SCENARIOS.slice(0, 12))
        );
        expect(
            verdicts.every((v) => v.createdAt === verdicts[0].createdAt)
        ).toBe(true);
    });
});

describe("evalPairsOf through the real builder, enumerator and probe", () => {
    it("prices Stone Rain's cast against passing: the hand term leaves, the opponent's land loss arrives", () => {
        const verdict = stoneRainVerdict();
        const { pairs, error } = evalPairsOf(verdict);
        expect(error).toBeUndefined();

        // The entry's matcher accepts every Stone Rain cast, including the
        // three that point it at the Bot's OWN Mountains; the constraint is
        // over the BEST accepted candidate, so there is exactly one pair and
        // its right side is the cast that takes a Forest.
        expect(pairs).toHaveLength(1);
        const [pair] = pairs;
        expect(pair.right.description).toBe("cast Stone Rain → Forest");
        expect(pair.other.description).toBe("pass");

        // Loses the hand term: Stone Rain's latent worth leaves the hand.
        expect(pair.terms.hand).toBeLessThan(0);
        // Gains the opponent's land loss: one fewer permanent and one fewer
        // mana source across the table, both read from the self − opponent
        // breakdown.
        expect(pair.terms.permanents).toBe(
            DEFAULT_EVAL_WEIGHTS.permanentWeight
        );
        expect(pair.terms.mana).toBeGreaterThan(0);

        // And the whole point of issue #3398's board-aware pricing: the latent
        // `boardRemoval` units the hand gives up are a FRACTION of a
        // representative victim, because a Forest is worth less than one.
        expect(pair.basis["latent.boardRemoval"]).toBeLessThan(0);
        expect(pair.basis["latent.boardRemoval"]).toBeGreaterThan(-1);
    });

    it("decomposes the policy value exactly: Σ wₖ·xₖ + residual", () => {
        const verdict = stoneRainVerdict();
        const { features } = evalPairsOf(verdict);
        expect(features.length).toBeGreaterThan(1);
        for (const f of features) {
            expect(
                scoreBasis(f.basis, DEFAULT_EVAL_WEIGHTS) + f.residual
            ).toBeCloseTo(f.policyValue, 6);
        }
        // The decomposition is not vacuous — some fittable weight actually
        // carries units on this position.
        expect(
            FITTABLE_WEIGHT_KEYS.some((k) => Math.abs(features[0].basis[k]) > 0)
        ).toBe(true);
    });

    it("refuses a verdict whose candidates the rebuilt position no longer offers", () => {
        const verdict = stoneRainVerdict();
        const stale: Verdict = {
            ...verdict,
            candidates: [
                verdict.candidates[0],
                {
                    key: '{"kind":"conceded"}',
                    description: "a move that is gone",
                },
            ],
            answer: { kind: "right", rightIndexes: [0] },
        };
        const out = evalPairsOf(stale);
        expect(out.pairs).toEqual([]);
        expect(out.error).toContain("no longer enumerated");
    });
});

describe("the violation / contradiction report", () => {
    /** Two authored verdicts on ONE position, naming opposite right answers
     *  over the same two candidates. A candidate LIST may be a subset of the
     *  enumeration — `evalPairsOf` only requires each key to resolve — which
     *  is what lets a counter-example be cut down to the couple it is about. */
    function contradictoryPair(): [Verdict, Verdict] {
        const base = stoneRainVerdict();
        const pass = base.candidates.find((c) => c.description === "pass");
        const cast = base.candidates.find(
            (c) => c.description === "cast Stone Rain → Forest"
        );
        expect(pass).toBeDefined();
        expect(cast).toBeDefined();
        const two = [pass!, cast!];
        const authored = (id: string, rightIndex: number): Verdict => ({
            ...base,
            id,
            candidates: two,
            answer: { kind: "right", rightIndexes: [rightIndex] },
            author: "verdicts.bot.test",
            source: "authored",
        });
        return [
            authored("authored:passing-is-right", 0),
            authored("authored:casting-is-right", 1),
        ];
    }

    it("finds two verdicts on one position that no weight vector can satisfy", () => {
        const [a, b] = contradictoryPair();
        const report = collectVerdictReport([a, b]);
        expect(report.errors).toEqual([]);
        expect(report.pairs).toHaveLength(2);
        expect(report.contradictions).toHaveLength(1);
        const [{ a: first, b: second }] = report.contradictions;
        expect([first.verdictId, second.verdictId].sort()).toEqual([
            "authored:casting-is-right",
            "authored:passing-is-right",
        ]);
        // Exactly one of the two is satisfied — the contradiction is real, not
        // an artefact of both being violated.
        expect(report.satisfied).toHaveLength(1);
        expect(report.violated).toHaveLength(1);
    });

    it("separates BLINDNESS from contradiction over the whole registry corpus", () => {
        const { verdicts, gaps } = verdictsFromRegistry();
        const report = collectVerdictReport(verdicts, { gaps });
        expect(report.errors).toEqual([]);
        expect(report.satisfied.length + report.violated.length).toBe(
            report.pairs.length
        );
        // The registry does hold positions the evaluation cannot separate at
        // all — every one of them a missing term (ADR 0124 §3) and, for a
        // violated one, the identical-vector proof §5 asks for.
        expect(report.blind.length).toBeGreaterThan(0);
        // And none of them is reported as a disagreement between judges: the
        // zero vector is its own negation, so folding them in would turn N
        // blind pairs into N² false contradictions.
        const blind = new Set(report.blind);
        expect(
            report.contradictions.filter(
                (c) => blind.has(c.a) || blind.has(c.b)
            )
        ).toEqual([]);
    });

    it("reports no contradiction when the two verdicts agree", () => {
        const [a] = contradictoryPair();
        const twin: Verdict = { ...a, id: "authored:passing-is-right-twin" };
        const report = collectVerdictReport([a, twin]);
        expect(report.contradictions).toEqual([]);
    });

    it("classifies each verdict by whether the evaluation already orders it", () => {
        const [a, b] = contradictoryPair();
        const report = collectVerdictReport([a, b]);
        const rows = Object.fromEntries(
            report.rows.map((r) => [r.verdictId, r])
        );
        // Under today's weights the 1-ply evaluation still prefers passing on
        // this board — the exact before-state `docs/research/greedy-vs-search.md`
        // measured, and the reason the entry needs the search.
        expect(rows["authored:passing-is-right"].ok).toBe(true);
        expect(rows["authored:casting-is-right"].ok).toBe(false);
        expect(rows["authored:casting-is-right"].violated).toBe(1);
    });
});
