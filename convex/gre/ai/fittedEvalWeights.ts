// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.291117,
    manaWeight: 12.320079,
    tappedManaWeight: 11.320079,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.549234,
    colorCoverageWeight: 22.174761,
    flexWeight: 5.939719,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505731,
    graveyardReachFraction: 0.17046,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.619417,
    latentFlashCreatureDiscount: 0.817694,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769959,
    latent: Object.freeze({
        damage: 21.266341,
        cardAdvantage: 44.581625,
        lifeSwing: 7.618186,
        boardRemoval: 155.522234,
        ramp: 11.91639,
        evasion: 40,
        tempo: 53.633924,
        disruption: 130.654195,
        recursion: 135.205998,
        tokens: 0.490228,
        pump: 8.698149,
        protection: 60,
        recurrence: 8.146942,
    }),
});
