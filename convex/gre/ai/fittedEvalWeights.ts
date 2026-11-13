// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.320015,
    manaWeight: 12.342248,
    tappedManaWeight: 11.342248,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.775255,
    colorCoverageWeight: 22.544204,
    flexWeight: 5.907116,
    combatReserveWeight: 6.076826,
    landTempoWeight: 3.057724,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505452,
    graveyardReachFraction: 0.169926,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.620481,
    latentFlashCreatureDiscount: 0.819855,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769004,
    latent: Object.freeze({
        damage: 21.262238,
        cardAdvantage: 44.770558,
        lifeSwing: 7.635165,
        boardRemoval: 155.759325,
        ramp: 11.920846,
        evasion: 40,
        tempo: 53.748364,
        disruption: 130.693252,
        recursion: 135.442559,
        tokens: 0.504667,
        pump: 8.752831,
        protection: 60,
        recurrence: 8.140135,
    }),
});
