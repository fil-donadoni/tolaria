// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.172987,
    manaWeight: 12.151231,
    tappedManaWeight: 11.151231,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.365546,
    colorCoverageWeight: 21.344334,
    flexWeight: 6.21799,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505802,
    graveyardReachFraction: 0.170294,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.626284,
    latentFlashCreatureDiscount: 0.814736,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.77018,
    latent: Object.freeze({
        damage: 21.282564,
        cardAdvantage: 46.151089,
        lifeSwing: 7.613535,
        boardRemoval: 155.340859,
        ramp: 12,
        evasion: 40,
        tempo: 53.63159,
        disruption: 130,
        recursion: 135.005641,
        tokens: 0.487984,
        pump: 8.741616,
        protection: 60,
        recurrence: 8.148306,
    }),
});
