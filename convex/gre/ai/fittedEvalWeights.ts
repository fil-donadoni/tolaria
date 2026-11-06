// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.265641,
    manaWeight: 12.260578,
    tappedManaWeight: 11.260578,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.541399,
    colorCoverageWeight: 21.887349,
    flexWeight: 5.992556,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505873,
    graveyardReachFraction: 0.170546,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.625516,
    latentFlashCreatureDiscount: 0.815038,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.77045,
    latent: Object.freeze({
        damage: 21.277542,
        cardAdvantage: 46.155262,
        lifeSwing: 7.608955,
        boardRemoval: 155.550071,
        ramp: 12.163714,
        evasion: 40,
        tempo: 53.609385,
        disruption: 130.597291,
        recursion: 134.940255,
        tokens: 0.483933,
        pump: 8.68156,
        protection: 60,
        recurrence: 8.150299,
    }),
});
