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
    basisDirectionKey,
    collectVerdictReport,
    evalPairsOf,
    scoreBasis,
    verdictFromScenario,
    verdictsFromRegistry,
    withWeight,
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

    it("predicts the policy value at a DIFFERENT weight vector, to first order", () => {
        // The identity at the vector the basis was READ at holds by
        // construction (`residual` is defined as the leftover), so asserting
        // it proves nothing about the basis. What the Weight Fit actually
        // needs — and what this asserts — is that the decomposition still
        // predicts the policy value once the weights MOVE.
        const verdict = stoneRainVerdict();
        const moved = withWeight(
            DEFAULT_EVAL_WEIGHTS,
            "permanentWeight",
            DEFAULT_EVAL_WEIGHTS.permanentWeight * 1.5
        );
        const at0 = evalPairsOf(verdict).features;
        const at1 = evalPairsOf(verdict, moved).features;
        expect(at0.length).toBeGreaterThan(1);

        let moves = 0;
        for (let i = 0; i < at0.length; i++) {
            const predicted = scoreBasis(at0[i].basis, moved) + at0[i].residual;
            const actual = at1[i].policyValue;
            if (Math.abs(actual - at0[i].policyValue) > 1) moves++;
            // `permanentWeight` reaches the Stone Rain hand term twice over —
            // once as the board-presence weight and once inside
            // `latentBoardFor`'s victim ratio — so the decomposition is
            // first-order, not exact, and the error is the size of that
            // product. Measured at this 50% move: 0.03 margin points on ~54.
            expect(Math.abs(predicted - actual)).toBeLessThan(
                0.01 * Math.max(1, Math.abs(actual))
            );
        }
        // The bound is not vacuous: the weight move really did move the value
        // on at least one candidate.
        expect(moves).toBeGreaterThan(0);
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
        // all — every one a missing term (ADR 0124 §3) and the
        // identical-feature-vector proof §5 asks for.
        expect(report.blind.length).toBeGreaterThan(0);
        // Blind means the evaluation exposes NO difference: not a fittable
        // weight, not an `EvalTerms` contribution, not the decider's own
        // number. A basis-only test would call a pair blind that the
        // `creatures` term separates by hundreds of points, and a root rule
        // admitted on that "proof" would be admitted over an existing term.
        const violated = new Set(report.violated);
        for (const pair of report.blind) {
            expect(violated.has(pair)).toBe(true);
            expect(
                Object.entries(pair.terms).filter(([, v]) => Math.abs(v) > 1e-6)
            ).toEqual([]);
            expect(Math.abs(pair.delta)).toBeLessThan(1e-6);
        }
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

    it("treats an anti-parallel direction as contradictory whatever its scale", () => {
        // `w · v ≥ δ` and `w · (−2v) ≥ δ` are exactly as irreconcilable as `v`
        // against `−v`, so the canonical key is over the DIRECTION. Asserted
        // on the pure canonicalisation rather than on a position, because no
        // registry board happens to produce two pairs that are scaled
        // multiples of one another.
        const zero = Object.fromEntries(
            FITTABLE_WEIGHT_KEYS.map((k) => [k, 0])
        ) as Record<(typeof FITTABLE_WEIGHT_KEYS)[number], number>;
        const v = { ...zero, lifeWeight: 3, manaWeight: -1 };
        const scaledOpposite = { ...zero, lifeWeight: -6, manaWeight: 2 };
        const elsewhere = { ...zero, lifeWeight: 3, manaWeight: 1 };
        expect(basisDirectionKey(scaledOpposite, -1)).toBe(
            basisDirectionKey(v, 1)
        );
        expect(basisDirectionKey(elsewhere, -1)).not.toBe(
            basisDirectionKey(v, 1)
        );
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
