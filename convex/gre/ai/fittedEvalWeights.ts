// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.29508,
    manaWeight: 12.326469,
    tappedManaWeight: 11.326469,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.545094,
    colorCoverageWeight: 22.150695,
    flexWeight: 5.962826,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505793,
    graveyardReachFraction: 0.17055,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.622653,
    latentFlashCreatureDiscount: 0.817238,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770169,
    latent: Object.freeze({
        damage: 21.262156,
        cardAdvantage: 44.573661,
        lifeSwing: 7.615452,
        boardRemoval: 155.450262,
        ramp: 11.915405,
        evasion: 40,
        tempo: 53.623858,
        disruption: 130.654827,
        recursion: 135.117302,
        tokens: 0.487191,
        pump: 8.696119,
        protection: 60,
        recurrence: 8.148535,
    }),
});
