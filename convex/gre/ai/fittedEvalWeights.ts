// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.296385,
    manaWeight: 12.326028,
    tappedManaWeight: 11.326028,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.537492,
    colorCoverageWeight: 21.906129,
    flexWeight: 5.953838,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505834,
    graveyardReachFraction: 0.170152,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.62841,
    latentFlashCreatureDiscount: 0.813306,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770359,
    latent: Object.freeze({
        damage: 21.315502,
        cardAdvantage: 48.619093,
        lifeSwing: 7.626832,
        boardRemoval: 155.901117,
        ramp: 12.162908,
        evasion: 40,
        tempo: 53.620601,
        disruption: 130.605727,
        recursion: 134.844933,
        tokens: 0.486684,
        pump: 8.684265,
        protection: 60,
        recurrence: 8.148978,
    }),
});
