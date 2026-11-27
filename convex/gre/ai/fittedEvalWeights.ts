// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.232555,
    manaWeight: 12.183066,
    tappedManaWeight: 11.183066,
    finiteManaUseWeight: 4,
    manaDevWeight: 12.096397,
    colorCoverageWeight: 23.906847,
    flexWeight: 5.981008,
    combatReserveWeight: 6.04457,
    landTempoWeight: 3.035948,
    deckingWeight: 1.5,
    poisonWeight: 2,
    energyWeight: 6.030987,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503327,
    graveyardReachFraction: 0.165699,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.689617,
    latentFlashCreatureDiscount: 0.863335,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.762197,
    costTaxWeight: 5.958856,
    costTaxLibraryWeight: 6,
    latent: Object.freeze({
        damage: 22.224376,
        cardAdvantage: 45.161623,
        lifeSwing: 7.748334,
        boardRemoval: 159.716718,
        ramp: 11.759997,
        evasion: 40,
        tempo: 52.818013,
        disruption: 134.74323,
        recursion: 136.802412,
        tokens: 0.817152,
        pump: 8.993757,
        protection: 60,
        recurrence: 8.08034,
    }),
});
