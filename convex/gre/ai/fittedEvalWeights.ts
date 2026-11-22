// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.231508,
    manaWeight: 12.175983,
    tappedManaWeight: 11.175983,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.813095,
    colorCoverageWeight: 23.273464,
    flexWeight: 5.995521,
    combatReserveWeight: 6.052735,
    landTempoWeight: 3.040457,
    deckingWeight: 1.502021,
    poisonWeight: 2,
    energyWeight: 6.034879,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503775,
    graveyardReachFraction: 0.16467,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.636243,
    latentFlashCreatureDiscount: 0.763958,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76359,
    costTaxWeight: 5.952455,
    latent: Object.freeze({
        damage: 21.872985,
        cardAdvantage: 45.049127,
        lifeSwing: 7.705331,
        boardRemoval: 157.229411,
        ramp: 11.961769,
        evasion: 40,
        tempo: 52.497552,
        disruption: 135.957081,
        recursion: 136.870222,
        tokens: 0.645608,
        pump: 8.855345,
        protection: 60,
        recurrence: 8.093393,
    }),
});
