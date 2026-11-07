// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.297318,
    manaWeight: 12.331447,
    tappedManaWeight: 11.331447,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.541598,
    colorCoverageWeight: 22.1366,
    flexWeight: 5.962618,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505841,
    graveyardReachFraction: 0.170698,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.622153,
    latentFlashCreatureDiscount: 0.816904,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.77033,
    latent: Object.freeze({
        damage: 21.257043,
        cardAdvantage: 44.565952,
        lifeSwing: 7.612621,
        boardRemoval: 155.431774,
        ramp: 11.914706,
        evasion: 40,
        tempo: 53.611813,
        disruption: 130.657973,
        recursion: 135.075089,
        tokens: 0.484754,
        pump: 8.693679,
        protection: 60,
        recurrence: 8.149782,
    }),
});
