// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.455136,
    manaWeight: 12.91914,
    tappedManaWeight: 11.41914,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.077947,
    colorCoverageWeight: 22.035844,
    flexWeight: 6.861299,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.5,
    graveyardReachFraction: 0.15965,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.708209,
    latentFlashCreatureDiscount: 0.807315,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.323071,
        cardAdvantage: 50.064542,
        lifeSwing: 7.583026,
        boardRemoval: 144.419729,
        ramp: 12,
        evasion: 40,
        tempo: 53.65881,
        disruption: 130,
        recursion: 140,
        tokens: 0.467312,
        pump: 6.955875,
        protection: 60,
        recurrence: 6.263531,
    }),
});
