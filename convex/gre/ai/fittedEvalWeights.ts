// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.228136,
    manaWeight: 12.184144,
    tappedManaWeight: 11.184144,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.826891,
    colorCoverageWeight: 23.860047,
    flexWeight: 5.98395,
    combatReserveWeight: 6.044667,
    landTempoWeight: 3.035905,
    deckingWeight: 1.501818,
    poisonWeight: 2,
    energyWeight: 6.030938,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503323,
    graveyardReachFraction: 0.165657,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.685854,
    latentFlashCreatureDiscount: 0.783688,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.762175,
    costTaxWeight: 5.957785,
    latent: Object.freeze({
        damage: 22.214726,
        cardAdvantage: 45.269576,
        lifeSwing: 7.747888,
        boardRemoval: 157.223095,
        ramp: 11.770457,
        evasion: 40,
        tempo: 52.818346,
        disruption: 135.338651,
        recursion: 136.830196,
        tokens: 0.813137,
        pump: 8.996126,
        protection: 60,
        recurrence: 8.08008,
    }),
});
