// The single, explicit calibration surface for the play Bot's leaf evaluator
// (`convex/gre/evaluate.ts`) and search reward mapping (`convex/gre/search.ts`)
// — issue #2683, prerequisite of calibration (#1929), a fitted evaluation, and
// ladder-variant strength experiments (map #1892). Before this module every
// weight was a scattered module-level constant; a calibration fit or a
// strength experiment had to edit source and rebuild. Now `evaluate()` and the
// reward mapping take an explicit `EvalWeights` vector (defaulted to
// `DEFAULT_EVAL_WEIGHTS`, so every existing call site is unchanged), and
// `SearchVariant.evalWeights` (`searchVariant.ts`) lets a ladder run override
// any subset with no code edit.
//
// THE LINE THIS TYPE DRAWS (read before adding a field): a constant belongs
// here iff it scales, weighs, or thresholds a term the evaluator or the
// reward mapping produces — a magnitude a calibration fit or a strength
// experiment could sensibly vary and still get a well-formed (if weaker or
// stronger) bot. A constant is deliberately EXCLUDED when it is a STRUCTURAL
// SEARCH BOUND instead: a value the ISMCTS algorithm needs to hold a specific
// invariant (termination, a bounded rollout, a fixed resource ceiling) rather
// than to express a preference. Swapping a structural bound changes what the
// search COMPUTES, not how good its answer is — a vector allowed to set
// `MAX_TREE_DEPTH: 0` is a footgun, not a strength lever. The excluded
// structural bounds stay module consts in `search.ts`: `MAX_TREE_DEPTH`,
// `MAX_ROLLOUT_PLIES`, `MAX_ROLLOUT_TURNS`, `ROLLOUT_EXTRA_BOT_TURNS`, and the
// production `DEFAULT_BUDGET` (`SearchBudget` — iterations/timeMs is already
// its own type, for the same reason: a resource ceiling, not an evaluation
// choice).
import type { Feature } from "./featureBasis";

/** The fitted price of ONE UNIT of each feature-basis dimension — the latent
 *  worth an Effect Script Op contributes per unit of what it does (issue
 *  #3398, PRD #3397). One weight per `FEATURE_BASIS` dimension, so a verdict
 *  can lower removal without lowering card draw (PRD #3397 story 11).
 *
 *  What ONE UNIT is, per dimension — the unit is part of the contract, since
 *  the weight is meaningless without it:
 *
 *   | dimension       | one unit                                              |
 *   | --------------- | ----------------------------------------------------- |
 *   | `damage`        | one point of damage                                   |
 *   | `cardAdvantage` | one card drawn                                        |
 *   | `lifeSwing`     | one life point                                        |
 *   | `boardRemoval`  | **one REPRESENTATIVE permanent taken off the board**  |
 *   | `ramp`          | one mana produced                                     |
 *   | `evasion`       | one temporary keyword grant                           |
 *   | `tempo`         | one representative permanent returned to hand         |
 *   | `disruption`    | one countered spell                                   |
 *   | `recursion`     | one creature returned from graveyard to battlefield   |
 *   | `tokens`        | one point of a created token's own body worth         |
 *   | `pump`          | one +1/+0 or +0/+1                                    |
 *   | `protection`    | one one-shot destroy-proof shield                     |
 *
 *  `boardRemoval` (and the `tempo` bounce that shares its victim) is the one
 *  whose unit count is NOT a constant: a targeted, board-affecting Op counts
 *  the realised board loss of its BEST LEGAL TARGET on the current board over
 *  the representative victim's (`ai/latentBoard.ts`), so Stone Rain against
 *  three Forests and Swords to Plowshares against Shivan Dragon are different
 *  numbers from the same weight. That is the whole point of issue #3398: the
 *  fixed `DESTROY_VALUE = 160` priced every removal spell at a 2/2 whatever it
 *  faced, so announcing Stone Rain against a 17-point land cost 205 margin
 *  points and the Bot never cast it (issue #3322,
 *  `docs/research/greedy-vs-search.md`).
 *
 *  With NO board attached (a context-free valuation — the Bot Drafter's pick
 *  heuristic, the resolution-choice ordering, a catalogue tool) the unit count
 *  falls back to exactly ONE representative victim, which is what reproduces
 *  today's numbers byte-for-byte. */
export type LatentWeights = Readonly<Record<Feature, number>>;

export type EvalWeights = {
    // --- evaluate.ts: leaf material/position weights (ADR 0018) -----------
    /** A won position's dominating, finite magnitude (`evaluate.ts`'s
     *  `WIN_SCORE`) — large enough that the bot always prefers lethal, finite
     *  so two winning lines stay comparable by material margin. */
    winScore: number;
    /** Per life point (`W_LIFE`; 20 life ≈ one creature). */
    lifeWeight: number;
    /** Board-presence bonus for every permanent in play (`W_PERMANENT`). */
    permanentWeight: number;
    /** Per UNTAPPED mana source (`W_MANA`). */
    manaWeight: number;
    /** Per TAPPED mana source (issue #3377). A tapped source is still a source:
     *  it untaps in its controller's next untap step (CR 502.3), so tapping one
     *  to pay for something forfeits this turn's option, not the permanent.
     *  Scored below `manaWeight` — having mana available NOW is worth something
     *  — but nowhere near zero, which is what it used to be worth.
     *
     *  Bounded on BOTH sides by measurement, not taste:
     *   - strictly BELOW `manaWeight`, or an untapped source stops outranking a
     *     tapped one and the bot cannot see that attacking with a mana dork
     *     costs it the mana (`evaluate.bot.test.ts`);
     *   - far enough ABOVE zero that tapping out for a lasting payoff is not a
     *     material loss. Measured on the issue-#3377 DecisionTrace: putting a
     *     permanent +1/+1 counter on a creature is worth `creatures` +29 against
     *     a `flexibility` −6, so four tapped sources must cost less than 23 —
     *     i.e. this weight must exceed 6.25. At 9 they cost 12, and the
     *     activation is correctly a gain.
     *
     *  The land-drop invariant (issue #149) is untouched: a land ENTERS
     *  untapped and so is still scored at the full `manaWeight`. */
    tappedManaWeight: number;
    /** Per on-curve land, the mana-development term (`W_MANA_DEV`, issue
     *  #2686): a land contributes this ON TOP of `permanentWeight` +
     *  `manaWeight` while the player's land count is still below the total
     *  mana value of the cards in hand (the mana the hand still wants to
     *  spend casting). A land whose mana the hand no longer needs (flooded)
     *  contributes zero. Sized symmetric with `manaWeight` so an on-curve
     *  land reads `5 + 12 + 12 = 29`, decisively above the 16 a 2-life gain
     *  is worth — see the calibration note in `evaluate.ts`'s
     *  `manaDevelopmentTerm`. */
    manaDevWeight: number;
    /** Bonus per castable held instant / live flexible activation, the
     *  reactive-flexibility term (`W_FLEX`). */
    flexWeight: number;
    /** Cap on how many instants/activations `flexWeight` credits
     *  (`FLEX_CARD_CAP`). */
    flexCardCap: number;
    /** Per extra distinct colour an untapped source can produce — smart
     *  auto-tap ranking only, never the bot's own move search
     *  (`W_SOURCE_BREADTH`). */
    sourceBreadthWeight: number;
    /** Bonus for an untapped source that is also dual-purpose (a manland) —
     *  smart auto-tap ranking only (`W_SOURCE_DUAL_PURPOSE`). */
    sourceDualPurposeWeight: number;
    /** Fraction of the worst-case held-trick swing folded into a declared
     *  block's valuation (`BLOCK_CAUTION_FRACTION`). */
    blockCautionFraction: number;
    /** Library size at or above which the decking term is EXACTLY ZERO
     *  (`libraryTerm`, evaluate.ts). Narrow support in the ADR 0070 §5 sense:
     *  an ordinary mid-game library is above this, so the term cannot move a
     *  position that is not actually near decking. */
    deckingHorizon: number;
    /** Per squared card of deficit below `deckingHorizon`. Quadratic so the
     *  gradient is shallow where decking is theoretical and steep where it
     *  decides the game — the same shape the danger clock uses for life. */
    deckingWeight: number;
    /** Per spell a graveyard-play ENGINE can still cast out of its
     *  controller's graveyard (`graveyardEngineTerm`, evaluate.ts). Zero
     *  contribution unless such an engine is on the battlefield, so the term
     *  is exactly absent from every ordinary board. Sized to make filling
     *  one's OWN graveyard visible against the library it costs, without
     *  forcing it: a self-mill must remain a choice the search explores, not
     *  one the leaf dictates. */
    graveyardEngineWeight: number;
    /** Cap on how many such spells are credited, so an enormous graveyard
     *  cannot dominate the leaf (the mana to cast them is the real limiter,
     *  and this term does not model it). */
    graveyardEngineCap: number;
    /** Fraction of a REACHABLE graveyard card's latent worth credited to its
     *  owner (`graveyardReachTerm`, evaluate.ts; issue #3042). Zero
     *  contribution unless the owner can actually reach the card — see
     *  `ai/graveyardReach.ts` for the gate; a graveyard with no reachable
     *  payoff scores exactly as it did before the term existed.
     *
     *  A FRACTION, not a weight on a count, and deliberately well below 1:
     *  the term must never make losing a permanent a wash. A creature dying
     *  moves its full realized worth out of the `creatures` term (plus
     *  `permanentWeight`) and returns only this fraction of its LATENT worth,
     *  so a trade stays a decisive loss and the bot does not start chump-
     *  blocking for free — the contrast `evaluate.bot.test.ts` measures. */
    graveyardReachFraction: number;
    /** How many reachable graveyard cards are credited, best-first. A payoff
     *  can be used a bounded number of times before the mana and the cards to
     *  use it run out, and this term models neither — so an enormous graveyard
     *  cannot dominate the leaf. */
    graveyardReachCap: number;

    // --- search.ts: tree selection + reward-mapping weights ----------------
    /** UCB1 exploration constant (`UCB_C`). The SOLE override path for this
     *  value is `SearchVariant.evalWeights.ucbC` (`searchVariant.ts`) — the
     *  old dedicated `SearchVariant.ucbC` field is retired in the same change
     *  that introduced this type, so there is exactly one place a ladder
     *  variant sets it. */
    ucbC: number;
    /** Weight of the soft reactive prior added to UCB1
     *  (`REACTIVE_PRIOR_C`). */
    reactivePriorC: number;
    /** Chance the rollout default policy plays a uniform-random move
     *  (`ROLLOUT_EPSILON`). */
    rolloutEpsilon: number;
    /** Lower rollout-policy random-move chance on a reactive combat line
     *  (`ROLLOUT_EPSILON_REACTIVE`). */
    rolloutEpsilonReactive: number;
    /** Soft penalty subtracted from a discouraged move's reward in the
     *  rollout default policy (`ROLLOUT_GUARDRAIL_PENALTY`). */
    rolloutGuardrailPenalty: number;
    /** Width of the reward band reserved, at each terminal extreme, for the
     *  surviving material margin (`TERMINAL_BAND`). */
    terminalBand: number;
    /** Material margin (in `evaluate` units) that fills a half-band
     *  (`MATERIAL_FULL`). */
    materialFull: number;
    /** Fitted logistic margin → win-probability constant, ladder corpus
     *  (`CALIBRATED_REWARD_K`; issue #1929). */
    calibratedRewardK: number;
    /** Weight of a choice-node prior in UCB1 selection (`CHOICE_PRIOR_C`). */
    choicePriorC: number;
    /** Visit-count band for "near-equal" root candidates (`VISIT_TOL`,
     *  issue #138). */
    visitTol: number;
    /** Mean-reward band for "outcome-equal" root candidates (`OUTCOME_EPS`). */
    outcomeEps: number;
    /** Material-unit estimate of an extra turn's worth, the structural
     *  extra-turn root-selection credit (`EXTRA_TURN_VALUE`, issue #244). */
    extraTurnValue: number;
    /** Dominating penalty per misdirected target slot, the announcement-
     *  variant tie-break (`MISDIRECTION_WEIGHT`, issue #1888). */
    misdirectionWeight: number;
    // --- opValuers.ts: latent per-dimension script weights (issue #3398) ---
    /** The fitted price of one unit of each feature-basis dimension — see
     *  `LatentWeights` above for what a unit IS per dimension. Replaces the
     *  hand-picked per-Op point constants (`DESTROY_VALUE` and its siblings)
     *  that `ai/opValuers.ts` used to carry: those were unreachable to a fit
     *  and blind to the board. */
    latent: LatentWeights;

    /** How many determinized worlds the block-quality root tie-break averages
     *  a candidate block over (`makeBlockDeltaLens`, issue #2876). It lives
     *  here rather than as a module const so a ladder variant can sweep it:
     *  the number it should be is an empirical question about how many samples
     *  separate "the opponent model says the trick is there" from the blind
     *  pool's dilution, and a const the ladder cannot move makes that question
     *  unfalsifiable. */
    blockWorldSamples: number;
};

/**
 * The HAND-PICKED vector — byte-for-byte the constants issue #2683 extracted
 * out of `evaluate.ts` and `search.ts`, and what the engine ran until the
 * Weight Fit (issue #3401, ADR 0124 §3) landed.
 *
 * It is not what the engine runs any more. It has two jobs now, and both are
 * the reason it stays a literal:
 *
 *  1. It is the fit's PRIOR and its LINEARISATION POINT. The fit minimises a
 *     hinge over the Eval Pairs plus `λ‖w − w0‖²` toward `w0`, and the pairs'
 *     feature basis is a derivative read AT `w0` (`verdicts/features.ts`). If
 *     `w0` were the previously fitted vector instead, every refit would
 *     regularise toward its own last answer and the weights would ratchet one
 *     trust region further from anything a human chose, forever, with the
 *     reproducibility guard unable to tell. `w0` is fixed, so
 *     `DEFAULT_EVAL_WEIGHTS` is a pure function of (this vector, the verdict
 *     corpus) and the guard re-runs it.
 *  2. It carries every NON-fittable constant — `winScore`, the caps and
 *     horizons, and every search-side knob. The fitted vector spreads this
 *     one and overrides only the fittable keys, so those constants have
 *     exactly one home and a change to `ucbC` is made here and nowhere else.
 *
 * The drift guard in `evalWeights.bot.test.ts` pins this literal: a change
 * here is a deliberate strength edit, never a silent one — and it obliges a
 * refit (`bun run fit:weights`).
 */
export const FIT_BASE_EVAL_WEIGHTS: Readonly<EvalWeights> = Object.freeze({
    winScore: 1_000_000,
    lifeWeight: 8,
    deckingHorizon: 12,
    deckingWeight: 1.5,
    graveyardEngineWeight: 60,
    graveyardEngineCap: 5,
    graveyardReachFraction: 0.15,
    graveyardReachCap: 2,
    permanentWeight: 5,
    manaWeight: 12,
    tappedManaWeight: 9,
    manaDevWeight: 12,
    flexWeight: 6,
    flexCardCap: 3,
    sourceBreadthWeight: 4,
    sourceDualPurposeWeight: 20,
    blockCautionFraction: 0.5,
    ucbC: 1.4,
    reactivePriorC: 0.5,
    rolloutEpsilon: 0.25,
    rolloutEpsilonReactive: 0.05,
    rolloutGuardrailPenalty: 0.05,
    terminalBand: 0.25,
    materialFull: 500,
    calibratedRewardK: 9.983957e-4,
    choicePriorC: 0.75,
    visitTol: 0.15,
    outcomeEps: 0.05,
    extraTurnValue: 350,
    misdirectionWeight: 1_000_000,
    // 12: the penalty is a step function of "does the attacker hold castable
    // interaction", so the mean is a proportion, and a proportion needs only
    // enough samples to separate a deck knowledge that names the trick (every
    // world) from the blind pool's dilution (issue #2789 measured ~1 world in
    // 21 on its own board). Its cost is per CONTENDER block edge — see
    // `makeBlockDeltaLens`' measurement.
    blockWorldSamples: 12,
    // Issue #3398 — chosen so today's per-Op numbers are reproduced where a
    // representative victim exists: `boardRemoval` 160 against one 2/2-worth
    // victim IS the old `DESTROY_VALUE`, `damage` 22 IS `DAMAGE_PER_POINT`,
    // and so on down the table. A re-parameterisation first; a behaviour
    // change only where the board says the victim is not a 2/2.
    latent: Object.freeze({
        damage: 22,
        cardAdvantage: 45,
        lifeSwing: 8,
        boardRemoval: 160,
        ramp: 12,
        evasion: 40,
        tempo: 55,
        disruption: 130,
        recursion: 140,
        tokens: 0.85,
        pump: 9,
        protection: 60,
    }),
});

/**
 * The FITTED vector the engine runs — GENERATED, not authored.
 *
 * Produced by `bun run fit:weights` from `FIT_BASE_EVAL_WEIGHTS` above and the
 * Verdict corpus (today: the blade registry's `moves` expectations, lowered by
 * `convex/gre/ai/verdicts/registrySource.ts`). The reproducibility guard in
 * `convex/gre/ai/__tests__/weightFit.bot.test.ts` re-runs that fit and demands
 * this exact object — the card-index lockfile discipline, so the weights in
 * code can never drift from the verdicts in git (PRD #3397 story 7).
 *
 * EDIT IT BY REFITTING, NEVER BY HAND. A weight you want moved is a Verdict
 * you have not written yet: add the position and the right move, run
 * `bun run fit:weights`, paste the block it prints. Changing a number here
 * reds the guard, which is the whole point.
 *
 * ADDING A BLADE ENTRY ALSO OBLIGES A REFIT — the registry IS the corpus, so a
 * new `moves` entry is a new verdict and the fitted vector moves with it. The
 * guard names the command when it reds.
 *
 * Only the FITTABLE keys are listed (`verdicts/features.ts`'
 * `FITTABLE_WEIGHT_KEYS`); everything else is spread from the base, so the
 * search constants have one home.
 */
export const DEFAULT_EVAL_WEIGHTS: Readonly<EvalWeights> = Object.freeze({
    ...FIT_BASE_EVAL_WEIGHTS,
    lifeWeight: 8,
    permanentWeight: 4.964785,
    manaWeight: 11.130224,
    tappedManaWeight: 10.130224,
    manaDevWeight: 9.017984,
    flexWeight: 5.874172,
    deckingWeight: 1.5,
    graveyardEngineWeight: 68.661836,
    graveyardReachFraction: 0.19673,
    latent: Object.freeze({
        damage: 20.858021,
        cardAdvantage: 37.74651,
        lifeSwing: 8,
        boardRemoval: 113.444095,
        ramp: 11.527219,
        evasion: 40,
        tempo: 55,
        disruption: 90.325337,
        recursion: 140,
        tokens: 0.85,
        pump: 9,
        protection: 60,
    }),
});

/** Reward gained per `evaluate` margin point in the OPEN band of
 *  `rewardFromValue` — `(1 − 2·terminalBand) / (2·materialFull)`, the open
 *  band's linear slope. DERIVED, never stored: a calibration vector sets
 *  `terminalBand` and `materialFull` independently, so this must always be
 *  recomputed from THEM rather than carry its own value that could drift out
 *  of sync with the two fields it is a function of. */
export function rewardPerMarginPoint(
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    return (1 - 2 * weights.terminalBand) / (2 * weights.materialFull);
}

/** A terminal `evaluate` magnitude dominates every material term —
 *  `weights.winScore / 2`. Derived from `winScore`, never stored, so a
 *  variant that changes `winScore` cannot leave this half stale. */
export function terminalMagnitude(
    weights: EvalWeights = DEFAULT_EVAL_WEIGHTS
): number {
    return weights.winScore / 2;
}
