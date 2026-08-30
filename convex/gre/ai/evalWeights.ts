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
    /** Per untapped mana source, the available-mana proxy (`W_MANA`). */
    manaWeight: number;
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
    /** Reward gained per Forge-scale combo point (`COMBO_REWARD`). */
    comboReward: number;
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
};

/** Today's production values — byte-for-byte the constants this refactor
 *  extracted (issue #2683). The drift guard in `evalWeights.bot.test.ts`
 *  pins this literal: a change here is a deliberate strength edit, never a
 *  silent one. */
export const DEFAULT_EVAL_WEIGHTS: Readonly<EvalWeights> = Object.freeze({
    winScore: 1_000_000,
    lifeWeight: 8,
    permanentWeight: 5,
    manaWeight: 12,
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
    comboReward: 0.00003,
    choicePriorC: 0.75,
    visitTol: 0.15,
    outcomeEps: 0.05,
    extraTurnValue: 350,
    misdirectionWeight: 1_000_000,
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
