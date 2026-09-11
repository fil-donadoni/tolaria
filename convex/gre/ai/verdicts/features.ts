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
// So it is read the only way that cannot drift from the evaluator: as a
// DERIVATIVE of the evaluator itself,
//
//     x_k  =  ∂ policyValue / ∂ w_k    (at the current vector w₀)
//
// obtained by scoring the SAME settled state under a weight vector with `w_k`
// nudged — no re-resolution, no second valuation authority, nothing to keep in
// sync. `policyValueOfSettled` (search.ts) is what makes that affordable: the
// probe runs once, the scoring runs once per fittable weight.
//
// WHAT `x_k` IS, EXACTLY — and what it is NOT. It is the TOTAL sensitivity of
// the policy value to `w_k`, which for most terms IS the unit count (`life`
// really is `lifeWeight × life`). It is NOT a unit count wherever a term
// weight reaches the position through a second, weight-dependent factor, and
// the flagship position of this module is one such place: `latentBoardFor`
// prices a removal spell in hand as
//
//     latent.boardRemoval × realisedLoss(best victim) / representativeVictimLoss(w)
//
// and BOTH sides of that ratio are built from `permanentWeight` / `manaWeight`
// (`evaluate.ts`'s `permanentRealisedValue`, `ai/latentBoard.ts`). The hand
// term is therefore a PRODUCT of two fittable weights, `policyValue` is NOT
// linear in each of them, and on the Stone Rain board the `pass` candidate
// reads `permanentWeight` 0.834 and `manaWeight` 0.925 — fractional, because
// they are sensitivities and not counts.
//
// The consequence for the Weight Fit (issue #3401), stated here so it is not
// discovered there: `Σ w·x + residual` reproduces `policyValue` EXACTLY at w₀
// and to FIRST ORDER away from it, with a residual that is itself weight-
// dependent through that product. Measured on the Stone Rain position, moving
// `permanentWeight` by 50% (5 → 7.5) the decomposition predicts 53.8074 against
// an actual 53.7778 — 0.03 margin points, 0.055%. That is small enough for a
// regularised, small-step fit and large enough that an unbounded one must not
// trust it; the fit owes a trust region, not a pretence of linearity.
//
// TWO MORE PLACES THE DERIVATIVE READS ZERO where value is nonetheless moving,
// both of them clamps rather than curves:
//   * a hand card whose script value falls back to the `base + MV` floor, or is
//     cut by `MAX_LATENT_SCRIPT_VALUE` (`cardValue.ts`), moves its `hand` term
//     with EVERY `latent.*` component reading zero — measured at 33 of the 160
//     must-tier pairs. The units are real; no fittable weight scales them.
//   * a creature's hand worth is `creatureValueRaw` outright, weight-free.
// The step is one-sided (forward), so a card sitting exactly on a clamp reads
// the slope of the side it is nudged into. A pair that moves `terms` while
// `basis` is silent is NOT evidence of a missing evaluation term — it is
// evidence of a term no WEIGHT reaches, which is why the report's blindness
// test (`report.ts`) demands both be zero.
//
// AND ONE THING THAT IS DELIBERATELY NOT DIFFERENTIATED. The settled state is
// produced once, at w₀, and reused for every bump. `settleStackForBreakdown`
// picks its branch BY the weights, so on a position with a suspended
// resolution this is `∂/∂w` of `policyValueOfSettled(probe(w₀), w)`, not of
// `policyValue(w)`. Freezing the branch is the point: a branch that flips
// mid-difference is a kink, and a decomposition taken across one describes
// neither side.
//
// WHAT IS LEFT OVER. Not every margin point is scaled by a fittable weight: a
// creature's Forge body value, a hand card's clamped floor, the Danger Clock,
// and a terminal win/loss magnitude are all weight-independent at w₀. That
// part is the `residual`, kept EXPLICIT rather than folded away, so
//
//     policyValue  ===  Σ w_k · basis_k  +  residual
//
// holds at w₀ by construction — and, because it holds BY CONSTRUCTION, the
// identity is worthless as a test of the basis. What is worth testing is the
// property the fit actually needs: that the same decomposition PREDICTS the
// policy value at a DIFFERENT weight vector. `verdicts.bot.test.ts` asserts
// that, on a real position, with the bound measured above.
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
 *   - `blockCautionFraction` — REACHABLE by the 1-ply policy (`evaluate.ts`'s
 *     `cautiousBlockPenalty`, folded in by `declaredBlockDelta` on any
 *     position with a confirmed block) and arithmetically the same SHAPE as
 *     every fittable weight: a scalar times a magnitude in margin points. It
 *     is held out anyway, and the reason is about the CORPUS, not the shape.
 *
 *     It is not the price of a quantity; it is the EXPECTATION of one over the
 *     attacker's unseen hand — "a fraction of the worst-case trick swing…the
 *     discount is the EXPECTED cost of an over-committed block against a
 *     loaded attacker, not a certainty" (`evaluate.ts`). Every Eval Pair is
 *     one fully-specified world: the verdict's author saw a board, and the
 *     rebuilt position hands `castableHeldInteraction` a single determinized
 *     hand. Fitting the hedge's magnitude on that is fitting a mean to one
 *     draw, and a corpus of single worlds is a biased sample of the
 *     distribution the hedge integrates over. ADR 0124 draws the same line in
 *     its consequences: "what the fit cannot do: invent a term, see past one
 *     ply, or resolve hidden information. Timing and bluff stay where the
 *     search and the (frozen) root rules are."
 *
 *     Measured, when it was in: the registry corpus pulled it down 20.7% and
 *     flipped the discriminating pair in `blockDeltaLens.bot.test.ts` — the
 *     bot stopped declining a block against a deck that MUST be holding Giant
 *     Growth (issue #3401). That is the symptom that sent us looking; the
 *     sampling argument is why it stays out.
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
    /** One entry per fittable weight: `∂ policyValue / ∂ wₖ` at the current
     *  vector — the `x` of ADR 0124 §3's `w · x`. A unit count wherever the
     *  weight enters linearly, a sensitivity where it does not (see the
     *  header's `latentBoardFor` product). */
    basis: Record<FittableWeightKey, number>;
    /** `policyValue − Σ wₖ·xₖ`: the margin points no fittable weight scales at
     *  this vector. Itself weight-dependent through the header's product, so a
     *  fit must treat it as a first-order constant inside a trust region, not
     *  as a fixed offset. */
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
 *  weight fit can actually move. With `weights` other than the vector the
 *  basis was read at, this is the FIRST-ORDER prediction of that part, not an
 *  identity; see the header. */
export function scoreBasis(
    basis: Record<FittableWeightKey, number>,
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    let total = 0;
    for (const key of FITTABLE_WEIGHT_KEYS)
        total += weightValue(weights, key) * basis[key];
    return total;
}
