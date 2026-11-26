// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.231918,
    manaWeight: 12.182829,
    tappedManaWeight: 11.182829,
    finiteManaUseWeight: 4,
    manaDevWeight: 12.048092,
    colorCoverageWeight: 23.897264,
    flexWeight: 5.978313,
    combatReserveWeight: 6.044592,
    landTempoWeight: 3.035893,
    deckingWeight: 1.5,
    poisonWeight: 2,
    energyWeight: 6.030938,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503322,
    graveyardReachFraction: 0.165722,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.68726,
    latentFlashCreatureDiscount: 0.863196,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.762177,
    costTaxWeight: 5.957775,
    latent: Object.freeze({
        damage: 22.222739,
        cardAdvantage: 45.121766,
        lifeSwing: 7.748347,
        boardRemoval: 157.252145,
        ramp: 11.770823,
        evasion: 40,
        tempo: 52.819481,
        disruption: 135.350392,
        recursion: 136.822806,
        tokens: 0.816671,
        pump: 8.993457,
        protection: 60,
        recurrence: 8.080011,
    }),
});
