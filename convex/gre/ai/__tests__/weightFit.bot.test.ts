// The Weight Fit (issue #3401, PRD #3397, ADR 0124 §3) — its contract, and
// the reproducibility guard that ties the committed weights to the verdicts.
//
// Two halves, and the second is the one with teeth:
//
//  1. The CONTRACT of `fitWeights`, on hand-built pairs where the right answer
//     is known by construction: determinism to the bit, the numeraire pinned,
//     a pair moving only the weights it loads, a contradictory couple reported
//     rather than resolved, the sign constraint and the declared bands held.
//  2. The REPRODUCIBILITY GUARD (PRD #3397 story 7): re-run the whole pipeline
//     — the blade registry lowered to verdicts, the Eval Pairs built at the
//     hand-picked prior, the fit — and demand `DEFAULT_EVAL_WEIGHTS` exactly.
//     This is the card-index lockfile discipline: a hand-edited weight, or a
//     new blade entry nobody refitted for, reds here and nowhere else.
//
// It lives in the BOT suite rather than the blade suite because it is a gate:
// the blade suite's must tier is the search's metric, this is the weights'.
// The whole pipeline is arithmetic over rebuilt positions — 96 verdicts, 175
// pairs, well under a second — so it costs the suite nothing.
import { describe, expect, it } from "vitest";
import { BLADE_SCENARIOS } from "../blade/registry";
import { DEFAULT_EVAL_WEIGHTS, FIT_BASE_EVAL_WEIGHTS } from "../evalWeights";
import {
    FITTABLE_WEIGHT_KEYS,
    collectVerdictReport,
    fitWeights,
    verdictsFromRegistry,
    weightValue,
    type EvalPair,
    type FittableWeightKey,
} from "../verdicts";
import type { EvalTerms } from "../../evaluate";

const ZERO_TERMS: Record<keyof EvalTerms, number> = {
    life: 0,
    hand: 0,
    creatures: 0,
    permanents: 0,
    mana: 0,
    manaDevelopment: 0,
    flexibility: 0,
    library: 0,
    graveyard: 0,
    graveyardReach: 0,
};

/** A pair that loads exactly the named weights, by one unit each, and whose
 *  candidates the evaluation currently reads as `delta` apart. Hand-built on
 *  purpose: the fit's CONTRACT is about arithmetic, and a real position would
 *  make "only the weights it loads" untestable — every real position loads
 *  most of them. The bridge to real positions is asserted by
 *  `verdicts.bot.test.ts`; the guard below runs the real corpus end to end. */
function pairLoading(
    id: string,
    loads: Partial<Record<FittableWeightKey, number>>,
    delta: number
): EvalPair {
    const basis = {} as Record<FittableWeightKey, number>;
    for (const k of FITTABLE_WEIGHT_KEYS) basis[k] = loads[k] ?? 0;
    let fittableDelta = 0;
    for (const k of FITTABLE_WEIGHT_KEYS)
        fittableDelta += weightValue(FIT_BASE_EVAL_WEIGHTS, k) * basis[k];
    return {
        verdictId: id,
        kind: "right",
        rightIndex: 0,
        otherIndex: 1,
        right: { key: `${id}:r`, description: `${id}: the right move` },
        other: { key: `${id}:o`, description: `${id}: the other move` },
        terms: { ...ZERO_TERMS },
        basis,
        fittableDelta,
        delta,
    };
}

describe("fitWeights — the contract (issue #3401)", () => {
    it("is deterministic: the same input gives the same vector, to the bit", () => {
        const pairs = [
            pairLoading("a", { permanentWeight: 2 }, -40),
            pairLoading("b", { "latent.boardRemoval": -1, manaWeight: 3 }, -10),
        ];
        const one = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS);
        const two = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS);
        // Bit-for-bit, not `toBeCloseTo`: a guard that re-runs the fit and
        // compares to a committed literal is worth nothing if the fit is only
        // approximately reproducible.
        expect(JSON.stringify(one.weights)).toBe(JSON.stringify(two.weights));
    });

    it("never moves the numeraire, even when the pair loads it hardest", () => {
        const result = fitWeights(
            [pairLoading("life-only", { lifeWeight: 5 }, -200)],
            FIT_BASE_EVAL_WEIGHTS
        );
        expect(result.weights.lifeWeight).toBe(
            FIT_BASE_EVAL_WEIGHTS.lifeWeight
        );
        // And with nothing else to move, the fit is a no-op rather than a
        // vector that drifted somewhere harmless-looking.
        for (const key of FITTABLE_WEIGHT_KEYS) {
            expect(weightValue(result.weights, key)).toBe(
                weightValue(FIT_BASE_EVAL_WEIGHTS, key)
            );
        }
    });

    it("moves only the weights the pair loads — the others EXACTLY unchanged", () => {
        const result = fitWeights(
            [pairLoading("removal", { "latent.boardRemoval": 1 }, -300)],
            FIT_BASE_EVAL_WEIGHTS
        );
        expect(result.weights.latent.boardRemoval).toBeGreaterThan(
            FIT_BASE_EVAL_WEIGHTS.latent.boardRemoval
        );
        for (const key of FITTABLE_WEIGHT_KEYS) {
            if (key === "latent.boardRemoval") continue;
            expect(weightValue(result.weights, key)).toBe(
                weightValue(FIT_BASE_EVAL_WEIGHTS, key)
            );
        }
    });

    it("…except through a band, which couples two weights on purpose", () => {
        // The other half of the invariant above, and the half a test on an
        // UNBANDED key can never see. A pair that loads only `manaWeight`
        // drags `tappedManaWeight` with it, because the band is a constraint
        // on their DIFFERENCE — and the difference stays inside the band,
        // which is the point of paying that price.
        const result = fitWeights(
            [pairLoading("hate-untapped-mana", { manaWeight: -20 }, -400)],
            FIT_BASE_EVAL_WEIGHTS
        );
        expect(result.weights.manaWeight).toBeLessThan(
            FIT_BASE_EVAL_WEIGHTS.manaWeight
        );
        expect(result.weights.tappedManaWeight).toBeLessThan(
            FIT_BASE_EVAL_WEIGHTS.tappedManaWeight
        );
        const gap = result.weights.manaWeight - result.weights.tappedManaWeight;
        expect(gap).toBeGreaterThanOrEqual(1);
        // Everything OUTSIDE the band is still exactly untouched.
        for (const key of FITTABLE_WEIGHT_KEYS) {
            if (key === "manaWeight" || key === "tappedManaWeight") continue;
            expect(weightValue(result.weights, key)).toBe(
                weightValue(FIT_BASE_EVAL_WEIGHTS, key)
            );
        }
    });

    it("refuses a vector it cannot verify instead of returning NaN", () => {
        // `margin` divides the loss, so zero poisons every coordinate at once
        // — and `NaN` satisfies every comparison the band and box checks make,
        // so without this the verification fails OPEN and the runner prints a
        // `NaN` block for a human to paste.
        expect(() =>
            fitWeights(
                [pairLoading("anything", { permanentWeight: 1 }, -50)],
                FIT_BASE_EVAL_WEIGHTS,
                { margin: 0 }
            )
        ).toThrow(/margin must be > 0/);
    });

    it("never prices a latent dimension whose prior is ZERO below zero", () => {
        // The sign floor is `w ≥ 0`, not the constant `u ≥ −1`: at a zero
        // prior the relative scale falls back to 1, so `−1` would price the
        // dimension at −1. No shipped prior is zero today; one will be.
        const w0 = {
            ...FIT_BASE_EVAL_WEIGHTS,
            latent: { ...FIT_BASE_EVAL_WEIGHTS.latent, tokens: 0 },
        };
        const result = fitWeights(
            [pairLoading("hate-tokens", { "latent.tokens": -50 }, -5_000)],
            w0,
            { trustRegion: 4 }
        );
        expect(result.weights.latent.tokens).toBe(0);
    });

    it("reports a contradictory couple instead of resolving it", () => {
        // Two verdicts that ask for opposite orders on the same vector. No
        // weight satisfies both; the fit must SAY so (ADR 0124: a wrong
        // verdict is found by reading, never by a weaker Bot).
        const pairs = [
            pairLoading("yes", { permanentWeight: 1 }, -50),
            pairLoading("no", { permanentWeight: -1 }, -50),
        ];
        const result = fitWeights(pairs, FIT_BASE_EVAL_WEIGHTS);
        expect(result.contradictions).toHaveLength(1);
        expect(
            [
                result.contradictions[0].a.verdictId,
                result.contradictions[0].b.verdictId,
            ].sort()
        ).toEqual(["no", "yes"]);
        // Both stay in the loss: the fit is pulled both ways and lands between
        // them, it does not pick a side.
        expect(result.violated.length).toBe(2);
    });

    it("keeps a tapped source strictly cheaper than an untapped one (CR 502.3)", () => {
        // The registry corpus pushes exactly here — the verdicts want the cost
        // of TAPPING down (PRD #3397 story 12) and, unconstrained, the fit
        // takes `tappedManaWeight` past `manaWeight`. The band is what stops
        // it; without one, the committed vector says a tapped source is worth
        // more than an untapped one.
        const result = fitWeights(
            [
                pairLoading(
                    "tap-out",
                    { tappedManaWeight: 4, manaWeight: -4 },
                    -400
                ),
            ],
            FIT_BASE_EVAL_WEIGHTS
        );
        const gap = result.weights.manaWeight - result.weights.tappedManaWeight;
        expect(gap).toBeGreaterThanOrEqual(1);
        expect(gap).toBeLessThanOrEqual(5.75);
    });

    it("never prices a weight below zero, however hard a pair pushes", () => {
        const result = fitWeights(
            [pairLoading("hate-mana", { manaWeight: -50 }, -5_000)],
            FIT_BASE_EVAL_WEIGHTS,
            // A trust region wide enough to walk through zero, so the sign
            // constraint is the only thing left holding.
            { trustRegion: 4 }
        );
        for (const key of FITTABLE_WEIGHT_KEYS) {
            expect(weightValue(result.weights, key)).toBeGreaterThanOrEqual(0);
        }
    });
});

describe("the committed weights ARE the fit of the committed verdicts (issue #3401)", () => {
    it("re-running the fit over the blade registry reproduces DEFAULT_EVAL_WEIGHTS", () => {
        const { verdicts, gaps } = verdictsFromRegistry(BLADE_SCENARIOS);
        const report = collectVerdictReport(verdicts, {
            gaps,
            weights: FIT_BASE_EVAL_WEIGHTS,
        });
        // A verdict the engine can no longer rebuild yields no pairs and would
        // shrink the corpus SILENTLY — the fit would still reproduce whatever
        // the smaller corpus says. The lockfile has to pin the input too.
        expect(
            report.errors,
            "a committed verdict no longer rebuilds — the corpus shrank"
        ).toEqual([]);
        const result = fitWeights(report.pairs, FIT_BASE_EVAL_WEIGHTS);
        expect(
            result.weights,
            "DEFAULT_EVAL_WEIGHTS is not the fit of the committed verdicts — " +
                "run `bun run fit:weights` and paste the block it prints. " +
                "A new blade `moves` entry is a new verdict and obliges a refit."
        ).toEqual(DEFAULT_EVAL_WEIGHTS);
    });
});
