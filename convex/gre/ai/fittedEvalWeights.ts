// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.30387,
    manaWeight: 12.310261,
    tappedManaWeight: 11.310261,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.039253,
    colorCoverageWeight: 21.268143,
    flexWeight: 6.203447,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.5,
    graveyardReachFraction: 0.163186,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.593134,
    latentFlashCreatureDiscount: 0.80003,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.779364,
    latent: Object.freeze({
        damage: 20.702601,
        cardAdvantage: 45.068048,
        lifeSwing: 7.418411,
        boardRemoval: 155.148495,
        ramp: 12,
        evasion: 40,
        tempo: 52.890273,
        disruption: 130,
        recursion: 140,
        tokens: 0.425,
        pump: 8.599096,
        protection: 60,
        recurrence: 8.22939,
    }),
});
