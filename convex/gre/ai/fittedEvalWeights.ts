// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.298489,
    manaWeight: 12.298741,
    tappedManaWeight: 11.298741,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.0191,
    colorCoverageWeight: 21.321198,
    flexWeight: 6.199041,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.5,
    graveyardReachFraction: 0.162944,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.594461,
    latentFlashCreatureDiscount: 0.800696,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.778811,
    latent: Object.freeze({
        damage: 20.722089,
        cardAdvantage: 45.069245,
        lifeSwing: 7.429054,
        boardRemoval: 155.154448,
        ramp: 12,
        evasion: 40,
        tempo: 52.934877,
        disruption: 130,
        recursion: 140,
        tokens: 0.425,
        pump: 8.607234,
        protection: 60,
        recurrence: 8.224674,
    }),
});
