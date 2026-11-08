// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.296554,
    manaWeight: 12.32986,
    tappedManaWeight: 11.32986,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.542768,
    colorCoverageWeight: 22.14129,
    flexWeight: 5.938422,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505825,
    graveyardReachFraction: 0.170647,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.622335,
    latentFlashCreatureDiscount: 0.817036,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770276,
    latent: Object.freeze({
        damage: 21.259182,
        cardAdvantage: 44.569013,
        lifeSwing: 7.613567,
        boardRemoval: 155.452384,
        ramp: 11.91501,
        evasion: 40,
        tempo: 53.615672,
        disruption: 130.660424,
        recursion: 135.089202,
        tokens: 0.485565,
        pump: 8.694525,
        protection: 60,
        recurrence: 8.149353,
    }),
});
