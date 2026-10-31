// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.664153,
    manaWeight: 13.082863,
    tappedManaWeight: 11.582863,
    finiteManaUseWeight: 4,
    manaDevWeight: 14.402497,
    colorCoverageWeight: 21.95028,
    flexWeight: 6.96956,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.15949,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.718193,
    latentFlashCreatureDiscount: 0.808887,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.517893,
        cardAdvantage: 46.958566,
        lifeSwing: 7.587148,
        boardRemoval: 160.473351,
        ramp: 12,
        evasion: 40,
        tempo: 53.6615,
        disruption: 130,
        recursion: 140,
        tokens: 0.467031,
        pump: 9.707474,
        protection: 60,
        recurrence: 6.250123,
    }),
});
