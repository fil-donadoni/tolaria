// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.294761,
    manaWeight: 12.328245,
    tappedManaWeight: 11.328245,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.54349,
    colorCoverageWeight: 22.151694,
    flexWeight: 5.93906,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.50581,
    graveyardReachFraction: 0.170704,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.618598,
    latentFlashCreatureDiscount: 0.817147,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770221,
    latent: Object.freeze({
        damage: 21.25792,
        cardAdvantage: 44.569027,
        lifeSwing: 7.613526,
        boardRemoval: 155.492083,
        ramp: 11.915247,
        evasion: 40,
        tempo: 53.614114,
        disruption: 130.659482,
        recursion: 135.137116,
        tokens: 0.486219,
        pump: 8.694133,
        protection: 60,
        recurrence: 8.148987,
    }),
});
