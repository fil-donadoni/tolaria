// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.223646,
    manaWeight: 12.17216,
    tappedManaWeight: 11.17216,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.825117,
    colorCoverageWeight: 23.858957,
    flexWeight: 5.983849,
    combatReserveWeight: 6.045264,
    landTempoWeight: 3.036368,
    deckingWeight: 1.50184,
    poisonWeight: 2,
    energyWeight: 6.031337,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503365,
    graveyardReachFraction: 0.165842,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.685273,
    latentFlashCreatureDiscount: 0.783025,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76233,
    costTaxWeight: 5.957239,
    latent: Object.freeze({
        damage: 22.217064,
        cardAdvantage: 45.272491,
        lifeSwing: 7.744843,
        boardRemoval: 157.20623,
        ramp: 11.767445,
        evasion: 40,
        tempo: 52.790072,
        disruption: 135.403969,
        recursion: 136.786152,
        tokens: 0.81266,
        pump: 8.995973,
        protection: 60,
        recurrence: 8.081066,
    }),
});
