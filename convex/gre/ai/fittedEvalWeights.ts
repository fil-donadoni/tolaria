// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.221628,
    manaWeight: 12.164003,
    tappedManaWeight: 11.164003,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.813616,
    colorCoverageWeight: 23.835998,
    flexWeight: 5.974677,
    combatReserveWeight: 6.049308,
    landTempoWeight: 3.039556,
    deckingWeight: 1.501981,
    poisonWeight: 2,
    energyWeight: 6.034084,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503656,
    graveyardReachFraction: 0.167091,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.682439,
    latentFlashCreatureDiscount: 0.768441,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.763412,
    costTaxWeight: 5.953349,
    latent: Object.freeze({
        damage: 22.262022,
        cardAdvantage: 45.061808,
        lifeSwing: 7.724399,
        boardRemoval: 156.930179,
        ramp: 11.746965,
        evasion: 40,
        tempo: 52.596148,
        disruption: 135.853515,
        recursion: 136.48362,
        tokens: 0.650796,
        pump: 8.867287,
        protection: 60,
        recurrence: 8.087525,
    }),
});
