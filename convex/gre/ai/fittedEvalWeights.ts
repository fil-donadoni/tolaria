// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.307956,
    manaWeight: 12.309806,
    tappedManaWeight: 11.309806,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.622464,
    colorCoverageWeight: 22.265947,
    flexWeight: 5.909892,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505638,
    graveyardReachFraction: 0.17018,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.620441,
    latentFlashCreatureDiscount: 0.818452,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769653,
    latent: Object.freeze({
        damage: 21.276546,
        cardAdvantage: 44.595283,
        lifeSwing: 7.623679,
        boardRemoval: 155.604092,
        ramp: 11.917966,
        evasion: 40,
        tempo: 53.656689,
        disruption: 130.669152,
        recursion: 135.287129,
        tokens: 0.494921,
        pump: 8.702895,
        protection: 60,
        recurrence: 8.14455,
    }),
});
