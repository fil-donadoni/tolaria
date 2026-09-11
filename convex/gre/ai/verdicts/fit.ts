// The Weight Fit — Eval Pairs in, an `EvalWeights` vector out (issue #3401,
// PRD #3397, ADR 0124 §3).
//
// ADR 0124 states it in one line: "each Eval Pair is a constraint
// `w · (x(right) − x(other)) ≥ δ`; the fit minimises a hinge loss plus
// `λ‖w − w0‖²` toward the current vector, under sign constraints and a fixed
// numeraire (life), by a fixed number of gradient steps. Same verdicts, same
// weights, to the bit." Everything below is the four decisions that line
// leaves open, each with the reason it went the way it did.
//
// ── 1. WHAT THE CONSTRAINT IS MEASURED ON ────────────────────────────────
// A pair carries `basis` (`x(right) − x(other)`, read at w₀) AND a residual:
// the margin points no fittable weight scales — a creature's Forge body
// value, a hand card sitting on its clamp, the Danger Clock, a terminal
// magnitude (`features.ts`). The number the 1-ply decider actually orders on
// is the SUM, so the constraint the fit solves is
//
//     ĝ(w)  =  w · basis  +  r        with  r = pair.delta − pair.fittableDelta
//
// and NOT `w · basis ≥ δ` on its own. The difference is not cosmetic: a pair
// whose residual already separates the candidates by 300 points needs no
// weight movement at all, and a fit blind to `r` would keep pushing weights
// to re-buy separation the position already has. `ĝ(w₀) = pair.delta` by
// construction, so the fit starts from exactly the ordering the report
// printed.
//
// `r` is treated as a constant. It is not one — it moves with the weights
// through `latentBoardFor`'s ratio (`features.ts`' header) — which is the
// whole reason for decision 3.
//
// ── 2. THE LOSS IS A SQUARED HINGE, AND THE COORDINATES ARE RELATIVE ─────
// Squared, `max(0, 1 − ĝ/δ)²`, because the fit is a FIXED number of gradient
// steps. Plain hinge has a discontinuous gradient exactly at the margin, so a
// fixed-step descent chatters across it and the vector that gets committed
// depends on which side the last step happened to land — which is a
// reproducibility guard that reds on nothing but arithmetic. The squared form
// is convex with a Lipschitz gradient, so a step of 1/L descends monotonically
// and the step count is a real stopping point. Divided by `δ` first, so the
// loss is dimensionless and `λ` means the same thing whatever the margin is.
//
// The optimisation variable is NOT `w` but the RELATIVE displacement
//
//     u_k  =  (w_k − w0_k) / s_k       s_k = |w0_k| (1 where w0_k = 0)
//
// because the vector spans four orders of magnitude — `latent.boardRemoval`
// 160 against `graveyardReachFraction` 0.15 — and one shared step size over
// absolute coordinates would move the big weights by rounding error while
// sending the small ones through zero. In `u` every coordinate means "this
// fraction of what the weight already is", the L2 penalty `λ‖u‖²` is the
// scale-free "don't move far from w₀" the ADR asks for, and the sign
// constraint `w ≥ 0` is just `u_k ≥ −1`.
//
// A coordinate no pair loads keeps gradient `2λu_k`, so starting at `u = 0`
// the DESCENT leaves it exactly zero — "a single pair moves only the weights
// it loads" holds by construction there, not by tolerance. The PROJECTION is
// the one exception and it is deliberate: a band couples two coordinates, so a
// pair that loads one side of a band can move the other. Measured, on a pair
// whose basis is `manaWeight −20` and exactly zero everywhere else:
// `manaWeight 12 → 6.06` (loaded) drags `tappedManaWeight 9 → 5.06` (basis 0),
// because the band is a constraint on their DIFFERENCE. The contract test
// covers both halves — an unbanded key that must not move at all, and a banded
// one that may.
//
// The descent guarantee that goes with the fixed step is exact only while the
// PROJECTION is exact, and `project` is an alternating box↔band projection —
// which lands in the intersection but not necessarily at its nearest point.
// Measured on the registry corpus the box clamp fires zero times in 4000 steps
// (max |u| 0.301 against a trust region of 0.5), so the alternation degenerates
// to the single half-space projection, which IS exact, and the loss is monotone
// to 1.8e-15. A caller TIGHTENING `trustRegion` leaves that regime and gets
// convergence into the feasible set without the monotonicity proof.
//
// ── 3. THE TRUST REGION IS A MEASUREMENT, NOT A TASTE ────────────────────
// `basis` is a derivative at w₀, so `ĝ` is a first-order prediction and is
// only worth trusting near w₀. `features.ts` measured the error: on the Stone
// Rain position, moving `permanentWeight` by 50% the decomposition predicts
// 53.8074 against an actual 53.7778 — 0.055%. So the box `|u_k| ≤ 0.5` is the
// region where the model the fit optimises is the model the engine runs; the
// default is that measured number and the option exists so a caller can
// tighten it, never to pretend the linearisation reaches further.
//
// ── 4. CONTRADICTORY PAIRS ARE KEPT IN THE LOSS ──────────────────────────
// Two pairs whose basis directions are exact negatives cannot both be
// satisfied by ANY `w`. It is tempting to drop them so the fit stops being
// tugged both ways — and it is exactly the wrong move: dropping one is the
// fit silently deciding which of two human verdicts is wrong, which is the
// judgement ADR 0124 reserves for a person reading the report. They stay in,
// the penalty bounds how far the tug can pull, and they are REPORTED. On
// today's registry corpus that is 170 couples over 175 pairs — the corpus is
// very nearly self-cancelling, so `λ‖u‖²` is doing most of the work of
// choosing the answer. Most of them are the combat positions that differ only
// in a life total `ScenarioSpec` cannot yet carry (issue #2147): a finding
// about the corpus, not about the weights.

import type { EvalWeights } from "../evalWeights";
import type { Feature } from "../featureBasis";
import {
    FITTABLE_WEIGHT_KEYS,
    weightValue,
    type FittableWeightKey,
} from "./features";
import type { EvalPair } from "./evalPairs";
import { contradictoryCouples, type Contradiction } from "./report";

/**
 * The separation a pair must reach, in `evaluate` margin points.
 *
 * DERIVATION. The scale is Forge's, pinned by `evaluate.ts`: one life is 8,
 * one permanent 5, a vanilla 2/2 ≈ 170. A margin has to clear two floors and
 * stay under one ceiling:
 *
 *   - above the TIE floor. Two candidates inside `outcomeEps` of each other
 *     are decided by rollout noise (`/bot-slice` phase 0, step 2), and the
 *     smallest real material distinction the evaluation draws — one permanent
 *     — is 5 points. A margin of that order asks the evaluation only to have
 *     an opinion, not to hold it.
 *   - above the JITTER floor. `manaDevWeight` flipping one land on or off
 *     curve is 12 points, `tappedManaWeight` tapping a source 9; a margin
 *     under ~30 would be bought back by an irrelevant land drop.
 *   - below a CREATURE. At 170, a margin of that size would demand that every
 *     judged move beat its alternatives by a whole 2/2 — and most verdicts are
 *     about positions where the right move is better by a permanent and a
 *     card, not by a creature. A margin above the ceiling makes correct pairs
 *     read as violations and drags the weights toward satisfying them.
 *
 * 100 points sits in the band: an order of magnitude over the jitter floor,
 * two thirds of a 2/2, and — the number PRD #3397 names — the order of the
 * 205-point gap that kept Stone Rain uncast (issue #3322). It is a
 * SEPARATION, not a prediction: the fit never claims the right move is worth
 * 100 more, only that the evaluation must not be within 100 of getting the
 * order wrong.
 */
export const FIT_MARGIN = 100;

/** How far, as a fraction of its own size, one weight may move. The measured
 *  edge of the first-order model — see the header, decision 3. */
export const FIT_TRUST_REGION = 0.5;

/** Pull toward `w0`, over the dimensionless relative coordinates. Swept on
 *  the registry corpus (168 pairs) at the committed margin and trust region:
 *
 *      λ      pairs satisfied   ‖u‖∞   verdicts fully ordered
 *      0.01   see the PR's sweep table — the fit's own report prints all four
 *      0.1    columns, and the committed value is the knee of that curve.
 *
 *  Sized so the fit buys the pairs a weight can actually reach without
 *  driving every reachable coordinate to the trust-region wall: a vector
 *  pinned on the box boundary is a vector the linearisation no longer
 *  describes, whatever its pair count says. */
export const FIT_LAMBDA = 0.05;

/** Fixed step count. Convex, Lipschitz gradient, step `1/L`: the iterate is
 *  monotone and converged long before this, so the number is a ceiling rather
 *  than a tuning knob — and it is FIXED because a convergence-threshold stop
 *  makes the committed vector depend on a float comparison. */
export const FIT_STEPS = 4_000;

/** The weight held fixed to pin the scale. Without it, multiplying the whole
 *  vector by a constant scales every `w · basis` and satisfies pairs for free
 *  — the fit would grow without bound and mean nothing (ADR 0124 §3, "a fixed
 *  numeraire (life)"). */
export const FIT_NUMERAIRE: FittableWeightKey = "lifeWeight";

/**
 * Orderings the vector must keep whatever the verdicts say, as a band on the
 * DIFFERENCE of two weights.
 *
 * These are not preferences a judge could overrule: they are structure the
 * evaluation's own arithmetic depends on, and a fit that walks through one
 * produces a vector that is wrong in a way no pair count can see. Each entry
 * says which two weights, the band their difference must stay in, and where
 * the band's ends were measured — never a taste.
 *
 * The one entry today is the one the registry corpus actually pushed through.
 * The verdicts want the cost of TAPPING a source down (PRD #3397 story 12:
 * "casting a spell should stop being charged more than its effect can ever
 * return" — a cast taps sources, and the evaluation charges for every one of
 * them), and left alone the fit takes `tappedManaWeight` PAST `manaWeight`,
 * making a tapped source worth more than an untapped one. That the fit is
 * pushing the right way and overshoots is the whole reason this is a
 * constraint and not a finding to report.
 */
const FIT_BANDS: readonly {
    /** The larger weight. */
    a: FittableWeightKey;
    /** The smaller one. `a − b` must stay inside `[min, max]`. */
    b: FittableWeightKey;
    min: number;
    max: number;
}[] = [
    {
        // CR 502.3 — a tapped source untaps in its controller's next untap
        // step, so it is strictly less available NOW and strictly more than
        // worthless. Both ends are `tappedManaWeight`'s own documented bounds
        // (`evalWeights.ts`), and both are load-bearing in the suite:
        //
        //  - FLOOR 1, and it is BINDING — say so rather than imply it was
        //    derived. The committed vector sits exactly on it (diff =
        //    1.000000), so these two weights are set by this constant and not
        //    by any verdict; with the band removed the corpus takes the pair
        //    to −2.598, i.e. the inversion. What the suite actually demands is
        //    only `cost > 0` (`evaluate.bot.test.ts`, three tapped sources).
        //    The 1 is the judgement on top of that: a gap below one margin
        //    point is smaller than every distinction the evaluation otherwise
        //    draws — a permanent is 5, a life point 8 — so at that size "an
        //    untapped source outranks a tapped one" is true in float
        //    arithmetic and false in play. It is the number to revisit first
        //    when the corpus stops being nearly self-cancelling.
        //  - CEILING 5.7, STRICTLY under the measured issue-#3377 bound. Same
        //    test: four tapped sources must come in under the +23 that trace's
        //    activation was worth, or no mana-costed activation can ever pay
        //    for itself — and that assertion is `< 23`, strict. 4 × 5.75 is 23
        //    exactly, so a fit landing on a 5.75 ceiling reds the suite on the
        //    sign of a float error; `bandViolations`' rounding slack would put
        //    it over outright. 4 × 5.7 = 22.8 leaves the strict bound real.
        a: "manaWeight",
        b: "tappedManaWeight",
        min: 1,
        max: 5.7,
    },
];

/** Decimals the fitted vector is rounded to before it is returned.
 *
 *  The committed weights are a SOURCE LITERAL that a guard re-derives and
 *  compares bit-for-bit, so the fit's output has to be a number a human can
 *  type back. `Math.round(v * 1e6) / 1e6` divides two exactly-representable
 *  values, so IEEE-754 returns the nearest double to the decimal — the same
 *  double the literal `12.345678` parses to. Rounding is the LAST step, so it
 *  is part of the fit's contract and not a cosmetic applied afterwards. */
const ROUND_DECIMALS = 6;

function roundWeight(v: number): number {
    const scale = 10 ** ROUND_DECIMALS;
    return Math.round(v * scale) / scale;
}

export type WeightFitOptions = {
    margin?: number;
    lambda?: number;
    steps?: number;
    trustRegion?: number;
    /** The weight pinned to fix the scale. `null` pins nothing — for a test
     *  that wants to watch the scale run away, never for a committed fit. */
    numeraire?: FittableWeightKey | null;
};

type ResolvedOptions = Required<Omit<WeightFitOptions, "numeraire">> & {
    numeraire: FittableWeightKey | null;
};

/** One weight's movement across the fit. */
export type WeightMovement = {
    key: FittableWeightKey;
    before: number;
    after: number;
    /** `(after − before) / s_k` — the relative coordinate the fit optimises,
     *  and the one to read: an absolute delta of 8 is nothing on
     *  `latent.boardRemoval` and a 90% swing on `lifeWeight`. */
    relative: number;
};

/** What the fit did to one pair. `predicted` is `w · basis + r` at the fitted
 *  vector — a FIRST-ORDER prediction, which is why the runner re-derives the
 *  real report at the fitted weights rather than trusting this column. */
export type FitPairOutcome = {
    pair: EvalPair;
    before: number;
    predicted: number;
    satisfiedBefore: boolean;
    satisfiedAfter: boolean;
};

export type WeightFitResult = {
    /** The fitted vector: `w0` with every fittable key replaced, rounded. */
    weights: EvalWeights;
    /** Every fittable weight, in `FITTABLE_WEIGHT_KEYS` order. */
    movement: WeightMovement[];
    /** One per input pair, same order. */
    outcomes: FitPairOutcome[];
    /** Pairs whose predicted gap is still under the margin — the subset of
     *  `outcomes` a reader has to look at. */
    violated: FitPairOutcome[];
    /** Couples that no vector can satisfy together: anti-parallel basis
     *  directions. Reported, never dropped (header, decision 4). */
    contradictions: Contradiction[];
    lossBefore: number;
    lossAfter: number;
    /** Pairs strictly ordered correctly (`> 0`) before / after — the ordering
     *  the decider makes, which is a weaker bar than the margin. */
    orderedBefore: number;
    orderedAfter: number;
    /** Pairs at or above the margin before / after. */
    separatedBefore: number;
    separatedAfter: number;
    options: ResolvedOptions;
};

/** Ceiling on the box↔band alternations one projection runs.
 *
 *  Both sets are convex, so alternating projection converges into their
 *  intersection — but not in one round when a band's correction walks a weight
 *  through the sign floor: the two then take turns, the residual shrinking
 *  geometrically (measured ratio 0.36 on the worst hand-built case, so 8
 *  rounds leave 2.8e-4 and 64 leave float noise). The loop exits as soon as a
 *  round moves nothing, which is the FIRST round on every ordinary position,
 *  so the ceiling costs nothing where it is not needed and it is FIXED so the
 *  fit stays deterministic. */
const PROJECTION_ROUNDS = 64;

/** Project the coordinates back onto the constraint set: the trust region and
 *  the sign constraint (a box), and the declared structural bands.
 *
 *  Ends on the BOX so the sign constraint holds exactly — a negative price for
 *  mana is not a near-miss, it is nonsense. The bands are then verified on the
 *  vector `fitWeights` returns, so a box and a band that genuinely cannot both
 *  hold throw rather than quietly resolve in the box's favour. */
function project(
    u: number[],
    w0: EvalWeights,
    scale: number[],
    frozen: boolean[],
    trustRegion: number,
    floor: number[]
): void {
    for (let round = 0; round < PROJECTION_ROUNDS; round++) {
        projectBox(u, frozen, trustRegion, floor);
        if (!projectBands(u, w0, scale, frozen)) break;
    }
    projectBox(u, frozen, trustRegion, floor);
}

/** Clip every free coordinate to the trust region and to `w_k ≥ 0`. */
function projectBox(
    u: number[],
    frozen: boolean[],
    trustRegion: number,
    floor: number[]
): void {
    for (let k = 0; k < u.length; k++) {
        if (frozen[k]) continue;
        // The trust region, then the sign constraint. At the default trust
        // region the sign floor is already slack, and it is enforced anyway
        // because a caller widening the region must not be able to buy a
        // negative price for life or mana.
        if (u[k] > trustRegion) u[k] = trustRegion;
        if (u[k] < -trustRegion) u[k] = -trustRegion;
        if (u[k] < floor[k]) u[k] = floor[k];
    }
}

/** The `u_k` at which `w_k` reaches zero — the sign constraint in the fit's own
 *  coordinates.
 *
 *  NOT the constant `−1`. `w_k = w0_k + s_k·u_k` with `s_k = |w0_k|`, so `−1`
 *  is the zero crossing only for a STRICTLY POSITIVE prior: at `w0_k = 0` the
 *  scale falls back to 1 and `−1` prices the weight at −1, and at a negative
 *  prior it clamps FURTHER negative. Neither is reachable from today's
 *  `FIT_BASE_EVAL_WEIGHTS` (every fittable prior is positive) and a latent
 *  dimension priced at 0 is entirely plausible — which is exactly when a
 *  hardcoded `−1` would ship a negative unit price. */
function signFloorOf(w0: EvalWeights, key: FittableWeightKey): number {
    const v = weightValue(w0, key);
    // A negative prior has no zero crossing below it, so the sign floor is not
    // a lower bound on `u` at all; the trust region is what bounds it.
    if (v < 0) return -Infinity;
    return v === 0 ? 0 : -1;
}

/** Every fittable weight the vector prices below zero, or moves outside the
 *  trust region. */
function boxViolations(
    weights: EvalWeights,
    w0: EvalWeights,
    trustRegion: number
): string[] {
    const slack = 2 * 10 ** -ROUND_DECIMALS;
    const out: string[] = [];
    for (const key of FITTABLE_WEIGHT_KEYS) {
        const after = weightValue(weights, key);
        const before = weightValue(w0, key);
        if (before >= 0 && after < -slack) {
            out.push(`${key} = ${after} is a negative price`);
            continue;
        }
        const scale = before === 0 ? 1 : Math.abs(before);
        const moved = Math.abs((after - before) / scale);
        if (moved > trustRegion + slack) {
            out.push(
                `${key} moved ${(100 * moved).toFixed(1)}%, outside the ±${100 * trustRegion}% trust region`
            );
        }
    }
    return out;
}

/** Every fittable weight that is not a finite number. */
function nonFiniteWeights(weights: EvalWeights): string[] {
    const out: string[] = [];
    for (const key of FITTABLE_WEIGHT_KEYS) {
        const v = weightValue(weights, key);
        if (!Number.isFinite(v)) out.push(`${key} = ${v} is not finite`);
    }
    return out;
}

/** Structural equality over every fittable weight — key-order free, unlike a
 *  `JSON.stringify` comparison, so reordering a literal cannot make two equal
 *  vectors read as different. */
export function fittableWeightsEqual(a: EvalWeights, b: EvalWeights): boolean {
    return FITTABLE_WEIGHT_KEYS.every(
        (key) => weightValue(a, key) === weightValue(b, key)
    );
}

/** Euclidean projection onto each band, in the relative coordinates. The
 *  difference `w_a − w_b` is linear in `u` with gradient `(s_a, −s_b)`, so a
 *  violation is corrected by the shortest step along that gradient. A
 *  coordinate the numeraire has frozen takes no share of the correction, which
 *  the other one then pays alone. Returns whether anything moved, so the
 *  alternation stops on the first round that finds every band already met. */
function projectBands(
    u: number[],
    w0: EvalWeights,
    scale: number[],
    frozen: boolean[]
): boolean {
    let moved = false;
    const index = new Map<FittableWeightKey, number>();
    FITTABLE_WEIGHT_KEYS.forEach((k, i) => index.set(k, i));
    for (const band of FIT_BANDS) {
        const ia = index.get(band.a);
        const ib = index.get(band.b);
        if (ia === undefined || ib === undefined) continue;
        const wa = weightValue(w0, band.a) + scale[ia] * u[ia];
        const wb = weightValue(w0, band.b) + scale[ib] * u[ib];
        const d = wa - wb;
        const target = d > band.max ? band.max : d < band.min ? band.min : d;
        if (target === d) continue;
        const ga = frozen[ia] ? 0 : scale[ia];
        const gb = frozen[ib] ? 0 : scale[ib];
        const norm = ga * ga + gb * gb;
        if (norm === 0) continue;
        // `d` moves by `s_a·Δu_a − s_b·Δu_b`, so the shortest correction is
        // along `(s_a, −s_b)` scaled by the overshoot over that gradient's
        // squared norm.
        const t = (d - target) / norm;
        u[ia] -= t * ga;
        u[ib] += t * gb;
        moved = true;
    }
    return moved;
}

/** Every band the returned vector violates, as prose. Empty is the contract. */
function bandViolations(weights: EvalWeights): string[] {
    // One rounding step of slack: the vector is rounded to `ROUND_DECIMALS`
    // AFTER the projection, which can move a difference sitting exactly on a
    // band end by one unit in the last place printed.
    const slack = 2 * 10 ** -ROUND_DECIMALS;
    const out: string[] = [];
    for (const band of FIT_BANDS) {
        const d = weightValue(weights, band.a) - weightValue(weights, band.b);
        if (d < band.min - slack || d > band.max + slack) {
            out.push(
                `${band.a} − ${band.b} = ${d} is outside [${band.min}, ${band.max}]`
            );
        }
    }
    return out;
}

/** The scale of one coordinate: what "move this weight by 100%" means. */
function scaleOf(w0: EvalWeights, key: FittableWeightKey): number {
    const v = weightValue(w0, key);
    return v === 0 ? 1 : Math.abs(v);
}

/** `w0` displaced by the relative coordinates `u`, rounded. Pure. */
export function weightsFromCoordinates(
    w0: EvalWeights,
    u: Record<FittableWeightKey, number>
): EvalWeights {
    const latent = { ...w0.latent } as Record<Feature, number>;
    const out = { ...w0 } as Record<string, unknown>;
    for (const key of FITTABLE_WEIGHT_KEYS) {
        const value = roundWeight(
            weightValue(w0, key) + scaleOf(w0, key) * u[key]
        );
        if (key.startsWith("latent.")) {
            latent[key.slice("latent.".length) as Feature] = value;
        } else {
            out[key] = value;
        }
    }
    out.latent = latent;
    return out as EvalWeights;
}

/**
 * Fit the evaluation's weights to the Eval Pairs.
 *
 * PURE and DETERMINISTIC: no clock, no randomness, no iteration over an
 * unordered structure. Identical `pairs`, `w0` and `options` give an
 * identical vector, to the bit — which is what lets a guard re-run it.
 */
export function fitWeights(
    pairs: readonly EvalPair[],
    // REQUIRED, and deliberately not defaulted to `DEFAULT_EVAL_WEIGHTS`. The
    // penalty pulls toward `w0` and the basis is a derivative read at `w0`, so
    // a fit seeded with the last fitted vector regularises toward its own
    // previous answer: repeat it and the weights ratchet one trust region
    // further from anything a human picked, every time, with the
    // reproducibility guard unable to notice. The prior is
    // `FIT_BASE_EVAL_WEIGHTS` and naming it is the caller's job.
    w0: EvalWeights,
    options: WeightFitOptions = {}
): WeightFitResult {
    const opts: ResolvedOptions = {
        margin: options.margin ?? FIT_MARGIN,
        lambda: options.lambda ?? FIT_LAMBDA,
        steps: options.steps ?? FIT_STEPS,
        trustRegion: options.trustRegion ?? FIT_TRUST_REGION,
        numeraire:
            options.numeraire === undefined ? FIT_NUMERAIRE : options.numeraire,
    };
    // Rejected here rather than absorbed: the loss divides by `margin`, so a
    // zero one turns the whole vector into `NaN` — and `NaN` satisfies every
    // comparison the constraint verification below makes, so it would fail
    // OPEN on the one failure mode that poisons every coordinate at once.
    // `bun run fit:weights` takes these as environment knobs, so a typo
    // reaches this function.
    if (!(opts.margin > 0)) {
        throw new Error(`fit margin must be > 0, got ${opts.margin}`);
    }
    if (!(opts.lambda >= 0)) {
        throw new Error(`fit lambda must be >= 0, got ${opts.lambda}`);
    }
    if (!(opts.steps >= 1)) {
        throw new Error(`fit steps must be >= 1, got ${opts.steps}`);
    }
    if (!(opts.trustRegion > 0)) {
        throw new Error(
            `fit trust region must be > 0, got ${opts.trustRegion}`
        );
    }
    const { margin, lambda, steps, trustRegion, numeraire } = opts;

    const keys = FITTABLE_WEIGHT_KEYS;
    const scale = keys.map((k) => scaleOf(w0, k));
    // A coordinate is FREE unless it is the numeraire. The numeraire keeps an
    // entry in every array (so indices line up with `FITTABLE_WEIGHT_KEYS`)
    // and is simply never stepped and never projected off zero.
    const frozen = keys.map((k) => k === numeraire);
    const floor = keys.map((k) => signFloorOf(w0, k));

    // `a[p][k] = s_k · basis_k` — the margin points a 100% move of weight k
    // buys on pair p. `base[p] = ĝ(w0) = pair.delta`, which already carries
    // the residual (header, decision 1).
    const a = pairs.map((pair) => keys.map((k, i) => scale[i] * pair.basis[k]));
    const base = pairs.map((pair) => pair.delta);

    const n = pairs.length;
    const u = keys.map(() => 0);

    // Squared hinge over `n` pairs: ∇²  ≤  (2/n)·Σ_p a_p a_pᵀ/δ² + 2λI, so a
    // step of 1/L descends monotonically. Σ‖a_p‖² is the trace bound — loose
    // by at most the vector's dimension, which costs iterations, never
    // correctness, and iterations are free here.
    let curvature = 2 * lambda;
    if (n > 0) {
        let trace = 0;
        for (const row of a) for (const v of row) trace += v * v;
        curvature += (2 * trace) / (n * margin * margin);
    }
    const step = curvature > 0 ? 1 / curvature : 0;

    const gradient = keys.map(() => 0);
    for (let t = 0; t < steps; t++) {
        for (let k = 0; k < keys.length; k++) gradient[k] = 2 * lambda * u[k];
        for (let p = 0; p < n; p++) {
            let g = base[p];
            const row = a[p];
            for (let k = 0; k < keys.length; k++) g += row[k] * u[k];
            const h = 1 - g / margin;
            if (h <= 0) continue;
            const c = (-2 * h) / (margin * n);
            for (let k = 0; k < keys.length; k++) gradient[k] += c * row[k];
        }
        for (let k = 0; k < keys.length; k++) {
            if (frozen[k]) continue;
            u[k] -= step * gradient[k];
        }
        project(u, w0, scale, frozen, trustRegion, floor);
    }

    const coordinates = {} as Record<FittableWeightKey, number>;
    keys.forEach((k, i) => (coordinates[k] = u[i]));
    const weights = weightsFromCoordinates(w0, coordinates);
    // Never a silent pass. A vector outside a constraint is structurally wrong
    // in a way no pair count reports, so the fit refuses to hand one back —
    // and the FINITENESS sweep comes first, because `NaN` satisfies every
    // comparison the other two make. The box is verified rather than assumed
    // for the same reason as the bands: `project` ends on the box, but the two
    // sets are reconciled by alternation, not by an exact joint projection.
    const broken = [
        ...nonFiniteWeights(weights),
        ...boxViolations(weights, w0, trustRegion),
        ...bandViolations(weights),
    ];
    if (broken.length > 0) {
        throw new Error(`weight fit broke a constraint: ${broken.join("; ")}`);
    }

    // Everything below is read off the ROUNDED vector, not off `u`: the
    // committed weights are what the engine will run, so the report must
    // describe them and not the pre-rounding iterate.
    const movement: WeightMovement[] = keys.map((key, i) => {
        const before = weightValue(w0, key);
        const after = weightValue(weights, key);
        return { key, before, after, relative: (after - before) / scale[i] };
    });

    const predictOn = (w: EvalWeights, p: number): number => {
        let g = base[p];
        for (let k = 0; k < keys.length; k++) {
            g +=
                (weightValue(w, keys[k]) - weightValue(w0, keys[k])) *
                pairs[p].basis[keys[k]];
        }
        return g;
    };

    const outcomes: FitPairOutcome[] = pairs.map((pair, p) => {
        const predicted = predictOn(weights, p);
        return {
            pair,
            before: base[p],
            predicted,
            satisfiedBefore: base[p] >= margin,
            satisfiedAfter: predicted >= margin,
        };
    });

    const hinge = (g: number): number => {
        const h = 1 - g / margin;
        return h > 0 ? h * h : 0;
    };
    const penalty = (w: EvalWeights): number => {
        let sum = 0;
        for (let k = 0; k < keys.length; k++) {
            const d =
                (weightValue(w, keys[k]) - weightValue(w0, keys[k])) / scale[k];
            sum += d * d;
        }
        return lambda * sum;
    };
    const lossOf = (w: EvalWeights): number => {
        let sum = 0;
        for (let p = 0; p < n; p++) sum += hinge(predictOn(w, p));
        return (n > 0 ? sum / n : 0) + penalty(w);
    };

    return {
        weights,
        movement,
        outcomes,
        violated: outcomes.filter((o) => !o.satisfiedAfter),
        contradictions: contradictoryCouples(pairs),
        lossBefore: lossOf(w0),
        lossAfter: lossOf(weights),
        orderedBefore: outcomes.filter((o) => o.before > 0).length,
        orderedAfter: outcomes.filter((o) => o.predicted > 0).length,
        separatedBefore: outcomes.filter((o) => o.satisfiedBefore).length,
        separatedAfter: outcomes.filter((o) => o.satisfiedAfter).length,
        options: opts,
    };
}

/** The vector, as the `DEFAULT_EVAL_WEIGHTS` literal a human commits. Only
 *  the fittable keys are printed — everything else in the vector is unchanged
 *  by construction, and printing it would invite a paste that silently
 *  overwrites a search constant with a stale copy. */
export function formatFittedWeights(result: WeightFitResult): string {
    const lines: string[] = [];
    for (const m of result.movement) {
        if (m.key.startsWith("latent.")) continue;
        lines.push(`    ${m.key}: ${m.after},`);
    }
    lines.push("    latent: Object.freeze({");
    for (const m of result.movement) {
        if (!m.key.startsWith("latent.")) continue;
        lines.push(`        ${m.key.slice("latent.".length)}: ${m.after},`);
    }
    lines.push("    }),");
    return lines.join("\n");
}

function signed(v: number, digits = 2): string {
    return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

/** The human report: what moved, what the fit bought, what it could not. */
export function formatWeightFitReport(
    result: WeightFitResult,
    pairsCount: number
): string {
    const { options: o } = result;
    const out: string[] = [];
    out.push(
        `== Weight Fit (issue #3401) — ${pairsCount} pairs, δ=${o.margin}, λ=${o.lambda}, trust=±${o.trustRegion}, ${o.steps} steps, numeraire ${o.numeraire ?? "none"}`
    );
    out.push(
        `  loss                   : ${result.lossBefore.toFixed(4)} → ${result.lossAfter.toFixed(4)}`
    );
    out.push(
        `  pairs ordered (Δ > 0)  : ${result.orderedBefore} → ${result.orderedAfter}`
    );
    out.push(
        `  pairs separated (≥ δ)  : ${result.separatedBefore} → ${result.separatedAfter}`
    );
    out.push(`  contradictory pairs    : ${result.contradictions.length}`);

    out.push(`\n== weight movement (relative, ordered by size)`);
    const moved = result.movement
        .filter((m) => m.relative !== 0)
        .sort((a, b) => Math.abs(b.relative) - Math.abs(a.relative));
    if (moved.length === 0) out.push("  (nothing moved)");
    for (const m of moved) {
        const wall =
            Math.abs(m.relative) >= o.trustRegion - 1e-9
                ? "  ← trust-region wall"
                : "";
        out.push(
            `  ${m.key.padEnd(26)} ${m.before} → ${m.after}   (${signed(100 * m.relative, 1)}%)${wall}`
        );
    }
    const still = result.movement.filter((m) => m.relative === 0);
    out.push(
        `  unmoved (${still.length}): ${still.map((m) => m.key).join(", ") || "—"}`
    );

    const gained = result.outcomes.filter(
        (x) => !x.satisfiedBefore && x.satisfiedAfter
    );
    const lost = result.outcomes.filter(
        (x) => x.satisfiedBefore && !x.satisfiedAfter
    );
    out.push(
        `\n== pairs the fit BOUGHT (${gained.length}) / gave up (${lost.length})`
    );
    for (const g of gained) {
        out.push(
            `  + ${g.pair.verdictId}\n      want  ${g.pair.right.description}\n      over  ${g.pair.other.description}\n      Δ ${g.before.toFixed(1)} → ${g.predicted.toFixed(1)}`
        );
    }
    for (const l of lost) {
        out.push(
            `  − ${l.pair.verdictId}\n      want  ${l.pair.right.description}\n      over  ${l.pair.other.description}\n      Δ ${l.before.toFixed(1)} → ${l.predicted.toFixed(1)}`
        );
    }

    out.push(
        `\n== pairs STILL under the margin (${result.violated.length}) — a missing term, a wrong verdict, or a residual no weight reaches`
    );
    for (const v of result.violated) {
        out.push(
            `  ${v.pair.verdictId}\n      want  ${v.pair.right.description}\n      over  ${v.pair.other.description}\n      Δ ${v.before.toFixed(1)} → ${v.predicted.toFixed(1)}`
        );
    }
    return out.join("\n");
}
