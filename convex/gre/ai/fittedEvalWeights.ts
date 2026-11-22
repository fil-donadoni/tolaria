// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.232327,
    manaWeight: 12.17763,
    tappedManaWeight: 11.17763,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.812517,
    colorCoverageWeight: 23.271023,
    flexWeight: 5.995704,
    combatReserveWeight: 6.053,
    landTempoWeight: 3.040603,
    deckingWeight: 1.502028,
    poisonWeight: 2,
    energyWeight: 6.035004,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503802,
    graveyardReachFraction: 0.164716,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.635939,
    latentFlashCreatureDiscount: 0.763682,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.763585,
    costTaxWeight: 5.95228,
    latent: Object.freeze({
        damage: 21.71451,
        cardAdvantage: 45.041789,
        lifeSwing: 7.704711,
        boardRemoval: 157.223747,
        ramp: 11.961616,
        evasion: 40,
        tempo: 52.488368,
        disruption: 135.977336,
        recursion: 136.859761,
        tokens: 0.645029,
        pump: 8.854812,
        protection: 60,
        recurrence: 8.095293,
    }),
});
