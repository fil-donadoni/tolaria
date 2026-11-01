// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.516096,
    manaWeight: 13.243692,
    tappedManaWeight: 11.743692,
    finiteManaUseWeight: 4,
    manaDevWeight: 12.681657,
    colorCoverageWeight: 22.062563,
    flexWeight: 6.933587,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.158869,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.641971,
    latentFlashCreatureDiscount: 0.823995,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.208892,
        cardAdvantage: 31.177194,
        lifeSwing: 7.59763,
        boardRemoval: 165.835194,
        ramp: 12,
        evasion: 40,
        tempo: 53.556242,
        disruption: 130,
        recursion: 140,
        tokens: 0.462601,
        pump: 7.51849,
        protection: 60,
        recurrence: 4,
    }),
});
