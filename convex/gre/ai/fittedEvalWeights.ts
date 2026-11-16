// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.282552,
    manaWeight: 12.284661,
    tappedManaWeight: 11.284661,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.591925,
    colorCoverageWeight: 22.673756,
    flexWeight: 5.868845,
    combatReserveWeight: 6.066014,
    landTempoWeight: 3.049939,
    deckingWeight: 1.502461,
    poisonWeight: 2,
    energyWeight: 6.04307,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504687,
    graveyardReachFraction: 0.169994,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.62371,
    latentFlashCreatureDiscount: 0.747225,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766603,
    costTaxWeight: 5.940878,
    latent: Object.freeze({
        damage: 21.565923,
        cardAdvantage: 45.111216,
        lifeSwing: 7.627256,
        boardRemoval: 156.733272,
        ramp: 11.95917,
        evasion: 40,
        tempo: 51.903293,
        disruption: 130.597599,
        recursion: 101.09761,
        tokens: 0.539725,
        pump: 8.827131,
        protection: 60,
        recurrence: 8.118243,
    }),
});
