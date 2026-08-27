// Search variant seam (issue #1924, map #1892 → decision #1895).
//
// The bot-vs-bot ladder compares two CONFIGURATION VARIANTS of the same engine
// in one process: `control` (production defaults, variant = null) vs
// `candidate` (one config override of difference). This module is that seam —
// a module-level "active variant" the ladder installs around each search call
// (the same install/uninstall pattern as `decisionTelemetry`'s sink), so the
// engine's signatures stay untouched and live play never pays for it.
//
// Determinism: a variant only swaps CONSTANTS consulted inside a synchronous
// `search()` call. Installing it around the call (set → search → clear in a
// `finally`) keeps the whole search — tree, rollouts, tie-breaks — under one
// consistent config, and bit-reproducibility (fixed iterations + seed) holds
// per variant.
//
// Growing the seam: a strength experiment lands as a new optional knob here
// plus one consultation at its use site in the engine, then registers a named
// entry in `LADDER_VARIANTS` so `bun run ladder --variant <name>` can A/B it.
// The knob stays until the ladder verdict lands the change as the new default
// (flag removed) or kills it.
//
// `evalWeights` (issue #2683) is the general form of that "new optional
// knob": ANY `EvalWeights` field, not just `ucbC`, can be overridden here with
// no new field and no new consultation site, because `search.ts` now threads
// the resolved vector explicitly instead of reading each constant at its own
// point of use. `resolveEvalWeights` below is the ONE place the override is
// applied — `runSearchWithTrace` calls it once per search and threads the
// result down; nothing downstream reads `getSearchVariant()` for a weight
// again. `ucbC` used to be its own dedicated field with its own read
// (`getSearchVariant()?.ucbC ?? UCB_C` at the old `ucb1`) — a second override
// path alongside this one. Retired in the same change that added
// `evalWeights`: `evalWeights.ucbC` is now the ONLY way a variant overrides
// it, so there is exactly one mechanism, not two competing ones.

import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "./evalWeights";

/** PUCT priors + first-play urgency on the MAIN action space (issue #2684).
 *
 *  Today ordinary priority moves carry `prior: 0` (`keyedMovesFor`) and are
 *  opened uniformly at random, one per iteration: with 75–90 legal moves at a
 *  main phase and a 400-iteration budget every root child gets ~5 visits
 *  before any gets a second look, so the search cannot separate close
 *  candidates. This knob gives them a real prior (the existing 1-ply rollout
 *  policy, `policyValue`) and folds unopened children into the SAME argmax as
 *  opened ones, so a promising line can be revisited before the last of 90
 *  siblings has been opened.
 *
 *  Bias, never deletion (map #1892 attack-order step 4): priors are floored
 *  strictly above zero and the PUCT term for an unopened child grows as
 *  `√(parentVisits)`, so every legal move is still opened eventually. There is
 *  NO top-K on the action space — a beam would cut sacrifice-then-payoff and
 *  combo-piece-first lines. */
export type ActionPriorConfig = {
    /** Prior source. Only `policyValue` today — the 1-ply lookahead the
     *  rollout default policy already uses (`search.ts`), so the prior and
     *  the rollout agree on what "good" means. */
    source: "policyValue";
    /** PUCT exploration weight: the bonus is `c · prior · √(parentVisits) /
     *  (1 + childVisits)`. */
    c: number;
    /** First-play-urgency REDUCTION: an unopened child's exploit estimate is
     *  the node's own mean reward minus this. It is a tunable RELUCTANCE to
     *  widen, not a ban — the unopened child still carries the same exploration
     *  term an opened sibling gets, so `fpu` only decides how much better than
     *  the node's average a fresh sibling has to look. */
    fpu: number;
};

export type SearchVariant = {
    /** Registry name — recorded in ladder JSONL headers and reports. */
    name: string;
    /** Priors + FPU on the ordinary action space (issue #2684). Absent =
     *  production behaviour: flat UCB1 and uniform-random expansion. */
    actionPriors?: ActionPriorConfig;
    /** Partial override of the production `EvalWeights` vector (issue #2683)
     *  — e.g. `{ ucbC: 0.7 }` or `{ manaWeight: 16 }`. Unset fields keep their
     *  `DEFAULT_EVAL_WEIGHTS` value; `resolveEvalWeights` does the merge. */
    evalWeights?: Partial<EvalWeights>;
    /** XOR mask applied to the per-decision search seed, for the candidate
     *  seat only (issue #1929). Changes WHICH determinizations ISMCTS samples
     *  and nothing else — same policy, same budget, same rules — so it is
     *  strength-neutral in expectation by construction. Consumed by the ladder
     *  runner (`playLadderGame`), never by search.ts: it perturbs the seed
     *  handed IN, not how the search behaves. */
    searchSeedMask?: number;
    /** Open-band reward mapping (issue #1929): "calibrated" swaps the linear
     *  clip (`materialSignal`) for the fitted logistic margin → win-prob
     *  (`CALIBRATED_REWARD_K` in search.ts). Absent = production linear clip. */
    rewardMapping?: "calibrated";
};

let activeVariant: SearchVariant | null = null;

/** Install (or clear, with null) the active variant. Ladder-only; live play
 *  never calls this, so production always runs with every knob at default. */
export function setSearchVariant(v: SearchVariant | null): void {
    activeVariant = v;
}

export function getSearchVariant(): SearchVariant | null {
    return activeVariant;
}

/** Resolve the ACTIVE `EvalWeights` vector for one search: `DEFAULT_EVAL_WEIGHTS`
 *  overridden field-by-field by `variant?.evalWeights` (issue #2683). The ONE
 *  consultation of a variant's weight overrides — called once, at the top of
 *  `runSearchWithTrace` (`search.ts`), which threads the result down as an
 *  explicit parameter through the whole search instead of leaving every
 *  constant's use site to re-read the module-global itself. `null`/undefined
 *  variant (live play, every test that doesn't install one) returns
 *  `DEFAULT_EVAL_WEIGHTS` verbatim — zero behaviour change outside a ladder
 *  run that actually sets `evalWeights`. */
export function resolveEvalWeights(variant: SearchVariant | null): EvalWeights {
    if (!variant?.evalWeights) return DEFAULT_EVAL_WEIGHTS;
    return { ...DEFAULT_EVAL_WEIGHTS, ...variant.evalWeights };
}

/** Resolve the ACTIVE action-prior config for one search (issue #2684).
 *  `null` — live play, every test that installs no variant, and every existing
 *  variant — means the selection rule is untouched: `search.ts` branches on
 *  this being null and takes the historical code path verbatim. Resolved once,
 *  beside `resolveEvalWeights`, at the top of `runSearchWithTrace`, and threaded
 *  down explicitly; nothing deeper re-reads the module-global. */
export function resolveActionPriors(
    variant: SearchVariant | null
): ActionPriorConfig | null {
    return variant?.actionPriors ?? null;
}

/** The named candidate configs `bun run ladder --variant <name>` can run.
 *
 *  A ladder run with NO variant is the control-vs-control null experiment. It
 *  necessarily returns EXACTLY 50%, and that is not a measurement: with no
 *  variant installed both seats run the identical config, so a pair's two
 *  orientations play the bit-identical game and only the candidate LABEL
 *  moves — one win and one loss per pair, by arithmetic. The 680-game run of
 *  2026-08-23 came back 20–20 in all 17 matchups, all 340 pairs agreeing on
 *  winner, turns and plies.
 *
 *  So a null run proves determinism (including across worker processes) and
 *  the absence of seat-attribution bias — worth having — but it does NOT
 *  measure the harness noise floor, as this comment used to claim. Nothing in
 *  it varies, so nothing about the variance of a REAL candidate leg follows
 *  from it.
 *
 *  The noise floor is what `placebo` below measures. Judge a candidate's win
 *  rate against THAT, never against a null run's tautological 50%. */
export const LADDER_VARIANTS: Record<string, SearchVariant> = {
    /** The noise-floor baseline (issue #1929). Same policy, same budget, same
     *  rules — only WHICH determinizations ISMCTS samples differs, so it is
     *  strength-neutral by construction and every point it scores away from
     *  50% is chaotic sensitivity: a different sampled world changes one
     *  move, which changes the position, which cascades.
     *
     *  Run it once at decision tier; its confidence interval is the band
     *  inside which a real candidate's result means nothing. Without it there
     *  is no baseline at all — a null run cannot vary (see above), so an
     *  IMPROVEMENT verdict would be unfalsifiable.
     *
     *  Why the seed and not a tiny `ucbC` nudge, which is the obvious idea:
     *  measured 2026-08-24 over 4 games, `ucbC * (1 + eps)` at eps = 1e-12,
     *  1e-9 and 1e-6 changed NOTHING — not a ply, not a winner (UCB scores
     *  are not separated that finely, so the argmax never moves). And a nudge
     *  big enough to bite would no longer be neutral: `ucbC` is a real knob
     *  that can help or hurt. The seed has no strategic content at all, which
     *  is exactly what a placebo needs. */
    placebo: {
        name: "placebo",
        // Arbitrary fixed mask — any value works; pinned so the run is
        // reproducible from its baseSeed like every other ladder run.
        searchSeedMask: 0x5bf03635,
    },

    // issue #1929 — margin → win-prob logistic fitted on the ladder corpus,
    // replacing the hand-set linear clip in the open reward band.
    "reward-calibrated": {
        name: "reward-calibrated",
        rewardMapping: "calibrated",
    },

    /** PUCT priors + FPU on the main action space (issue #2684, map #1892
     *  attack-order step 4).
     *
     *  `c` and `fpu` are on the reward scale the tree stores (a mean reward in
     *  [0, 1]). `c = 0.15` is NOT a first guess — it is the largest swept value
     *  that keeps the whole blade `must` tier green. Sweeping
     *  c ∈ {0.05, 0.1, 0.15, 0.2, 0.4, 0.8} over the entries the knob broke:
     *  at 0.2 the bot starts chump-blocking non-lethal damage (#2147), at 0.4
     *  it stops tapping a 0-counter Everflowing Chalice, and by 0.8 it also
     *  casts Phyrexian Dreadnought with no out, declines to cast Exalted Angel
     *  face down, and mis-targets Liliana's −2.
     *
     *  The DIRECTION of those failures is the finding, and it is why a prior on
     *  this engine has to stay gentle: `policyValue` is a 1-ply lookahead, and
     *  every blade entry it breaks is one authored precisely because greedy
     *  1-ply gets it wrong. Bias the search hard toward the prior and the
     *  search re-derives the prior.
     *
     *  `fpu` changed no blade verdict at any `c` in that sweep — those boards
     *  offer 2–6 legal moves, so there is barely anything to widen INTO. It
     *  bites on the 75–90-move main phases this ticket is actually about,
     *  which is exactly where the ladder measures. */
    "action-priors": {
        name: "action-priors",
        actionPriors: { source: "policyValue", c: 0.15, fpu: 0.15 },
    },

    /** WORKED EXAMPLE ONLY (issue #2683) — demonstrates that `evalWeights` can
     *  override a leaf-evaluator weight with no code edit ("a ladder variant
     *  can be `W_MANA: 16` with no code edit", the ticket's own example). NOT
     *  a strength claim: this refactor claims no strength, so this entry has
     *  never been run through the ladder and carries no verdict. Delete or
     *  replace it the moment a real `manaWeight` experiment needs the slot. */
    "eval-weights-demo": {
        name: "eval-weights-demo",
        evalWeights: { manaWeight: 16 },
    },
};
