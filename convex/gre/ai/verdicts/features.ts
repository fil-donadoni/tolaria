// The feature vector of ONE candidate move (issue #3400, PRD #3397, ADR 0124 §3).
//
// ADR 0124 states the Eval Pair constraint as `w · (x(right) − x(other)) ≥ δ`
// over "the unweighted term vector `x` read from the 1-ply settled state
// (`policyValue`'s probe)". Two things follow, and this module produces both.
//
// WHAT `x` HAS TO BE. For `w · x` to be the number the decider orders on, `x`
// must be the UNIT COUNTS and `w` the prices — not the products. The
// evaluator does not expose unit counts: `EvalTerms` carries weighted
// contributions (`life * lifeWeight`), the `hand` term is a sum of per-card
// latent values that mixes all twelve feature-basis dimensions, and
// `graveyardReach` mixes them again behind a fraction. Picking them apart by
// hand would mean a second copy of the evaluator's arithmetic, drifting from
// it the first time a term grew a clause.
//
// So the unit count is read the only way that cannot drift: as a DERIVATIVE.
// The policy value is linear in each fittable weight (every term is `weight ×
// something`, and the caps are on the COUNTS, not on the weights), so
//
//     x_k  =  ∂ policyValue / ∂ w_k
//
// is exactly the number of units of `k` the position holds, and it is obtained
// by scoring the SAME settled state under a weight vector with `w_k` nudged —
// no re-resolution, no second valuation authority, nothing to keep in sync.
// `policyValueOfSettled` (search.ts) is what makes that affordable: the probe
// runs once, the scoring runs once per fittable weight.
//
// WHAT IS LEFT OVER. Not every margin point is scaled by a fittable weight: a
// creature's Forge body value, a hand card's base-plus-mana-value floor, the
// Danger Clock, and a terminal win/loss magnitude are all weight-independent
// at this vector. That part is the `residual`, and it is kept EXPLICIT rather
// than folded away, so the identity
//
//     policyValue  ===  Σ w_k · basis_k  +  residual
//
// holds exactly and is asserted on a real position
// (`verdictFeatures.bot.test.ts`). A decomposition whose parts do not add back
// up to the thing decomposed is a fiction, and the identity is what makes this
// one checkable.
//
// The per-`EvalTerms` breakdown is carried ALONGSIDE, in margin points, purely
// because it is what a human reads: "the right move loses the hand term and
// gains the opponent's land loss" is a sentence about `terms`, not about
// `basis`. The report prints `terms`; the fit consumes `basis`.

import type { EvalTerms } from "../../evaluate";
import { evaluateBreakdown } from "../../evaluate";
import type { GameState } from "../../state";
import { policyValueOfSettled } from "../../search";
import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "../evalWeights";
import { FEATURE_BASIS, type Feature } from "../featureBasis";

/** Every `EvalTerms` key, as a value. A `Record<keyof EvalTerms, true>` rather
 *  than a hand-typed array so `tsc` reds when a new term ships without a row
 *  here — the same discipline `src/lib/ai/eval-term-labels.ts` uses. */
const EVAL_TERM_PRESENCE: Record<keyof EvalTerms, true> = {
    life: true,
    hand: true,
    creatures: true,
    permanents: true,
    mana: true,
    manaDevelopment: true,
    flexibility: true,
    library: true,
    graveyard: true,
    graveyardReach: true,
};

export const EVAL_TERM_KEYS = Object.keys(
    EVAL_TERM_PRESENCE
) as (keyof EvalTerms)[];

/**
 * The `EvalWeights` scalars the leaf evaluation's margin is LINEAR in, and
 * that a weight fit is allowed to move (ADR 0124 §3: "the evaluation's term
 * weights and the new latent-dimension weights; never the search's
 * constants").
 *
 * Deliberately absent, and why:
 *   - `winScore` — the dominating terminal magnitude, a structural ordering
 *     guarantee rather than a preference (ADR 0018). Fitting it would let a
 *     verdict make losing preferable to a creature.
 *   - `flexCardCap`, `graveyardEngineCap`, `graveyardReachCap`,
 *     `deckingHorizon` — counts and thresholds, not prices. The margin is
 *     piecewise-constant in them, so a derivative reads zero and means
 *     nothing.
 *   - `sourceBreadthWeight`, `sourceDualPurposeWeight` — `evaluateAutoTapPosition`
 *     only; they never reach the bot's own move search (`evaluate.ts`).
 *   - every search-side constant (`ucbC`, the rollout knobs, the reward
 *     banding, `visitTol`, `outcomeEps`, `extraTurnValue`,
 *     `misdirectionWeight`, `blockWorldSamples`) — out of scope by ADR.
 * Anything absent still shows up: it lands in `residual`, which the
 * reconstruction identity keeps honest.
 */
const FITTABLE_TERM_WEIGHTS = [
    "lifeWeight",
    "permanentWeight",
    "manaWeight",
    "tappedManaWeight",
    "manaDevWeight",
    "flexWeight",
    "deckingWeight",
    "graveyardEngineWeight",
    "graveyardReachFraction",
    // In `declaredBlockDelta`, which `policyValueOfSettled` folds in — an
    // evaluation term weight, reached by the 1-ply policy on any position
    // with a confirmed block.
    "blockCautionFraction",
] as const;

export type FittableTermWeight = (typeof FITTABLE_TERM_WEIGHTS)[number];
/** A latent feature-basis price, addressed as `latent.<dimension>`. */
export type FittableLatentWeight = `latent.${Feature}`;
export type FittableWeightKey = FittableTermWeight | FittableLatentWeight;

/** Every fittable weight, term weights first then the twelve latent
 *  dimensions — a stable order, so a printed vector is diffable. */
export const FITTABLE_WEIGHT_KEYS: readonly FittableWeightKey[] = [
    ...FITTABLE_TERM_WEIGHTS,
    ...FEATURE_BASIS.map((f): FittableLatentWeight => `latent.${f}`),
];

/** The value a fittable key currently holds in `weights`. */
export function weightValue(
    weights: EvalWeights,
    key: FittableWeightKey
): number {
    if (key.startsWith("latent.")) {
        return weights.latent[key.slice("latent.".length) as Feature];
    }
    return weights[key as FittableTermWeight];
}

/** `weights` with exactly one fittable key changed. */
export function withWeight(
    weights: EvalWeights,
    key: FittableWeightKey,
    value: number
): EvalWeights {
    if (key.startsWith("latent.")) {
        const dim = key.slice("latent.".length) as Feature;
        return { ...weights, latent: { ...weights.latent, [dim]: value } };
    }
    return { ...weights, [key]: value };
}

/** The nudge used to read `∂ policyValue / ∂ w_k`.
 *
 *  A RELATIVE power-of-two step (2^-10 of the weight) so `w + h` is exact in
 *  binary and the subtraction loses no significant digits — at the ~1e6
 *  magnitude a terminal position reaches, a naive decimal step would be eaten
 *  by float64 rounding. A zero weight gets the absolute fallback, since a
 *  relative step off zero is zero. */
const STEP_SCALE = 2 ** -10;
function stepFor(w: number): number {
    return w === 0 ? STEP_SCALE : Math.abs(w) * STEP_SCALE;
}

/** One candidate's features, read off the 1-ply settled state. */
export type FeatureVector = {
    /** The evaluation's per-term breakdown, SELF MINUS OPPONENT, in margin
     *  points. Human-readable; what the report prints. */
    terms: Record<keyof EvalTerms, number>;
    /** Unweighted unit counts, one per fittable weight — the `x` of
     *  `w · x`. */
    basis: Record<FittableWeightKey, number>;
    /** The margin points no fittable weight scales. */
    residual: number;
    /** `sum(self terms) − sum(opp terms)`, the pre-terminal material margin. */
    margin: number;
    /** The number the 1-ply greedy policy actually orders candidates by. */
    policyValue: number;
};

/**
 * Read the feature vector of an already-settled probe state, from `botId`'s
 * perspective. Pure: `settled` is only read.
 *
 * Cost is one `evaluateBreakdown` plus one `policyValueOfSettled` per fittable
 * weight — arithmetic over an existing state, no resolution, no search.
 */
export function featuresOfSettled(
    settled: GameState,
    botId: string,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): FeatureVector {
    const breakdown = evaluateBreakdown(settled, botId, weights);
    const terms = {} as Record<keyof EvalTerms, number>;
    for (const key of EVAL_TERM_KEYS) {
        terms[key] = breakdown.self[key] - breakdown.opp[key];
    }

    const base = policyValueOfSettled(settled, botId, weights);
    const basis = {} as Record<FittableWeightKey, number>;
    let explained = 0;
    for (const key of FITTABLE_WEIGHT_KEYS) {
        const w = weightValue(weights, key);
        const h = stepFor(w);
        const bumped = policyValueOfSettled(
            settled,
            botId,
            withWeight(weights, key, w + h)
        );
        const units = (bumped - base) / h;
        basis[key] = units;
        explained += w * units;
    }

    return {
        terms,
        basis,
        residual: base - explained,
        margin: breakdown.margin,
        policyValue: base,
    };
}

/** `a − b`, componentwise, over the fittable basis. */
export function subtractBasis(
    a: Record<FittableWeightKey, number>,
    b: Record<FittableWeightKey, number>
): Record<FittableWeightKey, number> {
    const out = {} as Record<FittableWeightKey, number>;
    for (const key of FITTABLE_WEIGHT_KEYS) out[key] = a[key] - b[key];
    return out;
}

/** `a − b`, componentwise, over the `EvalTerms` breakdown. */
export function subtractTerms(
    a: Record<keyof EvalTerms, number>,
    b: Record<keyof EvalTerms, number>
): Record<keyof EvalTerms, number> {
    const out = {} as Record<keyof EvalTerms, number>;
    for (const key of EVAL_TERM_KEYS) out[key] = a[key] - b[key];
    return out;
}

/** `w · x` over the fittable basis — the part of a policy-value difference a
 *  weight fit can actually move. */
export function scoreBasis(
    basis: Record<FittableWeightKey, number>,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    let total = 0;
    for (const key of FITTABLE_WEIGHT_KEYS)
        total += weightValue(weights, key) * basis[key];
    return total;
}
