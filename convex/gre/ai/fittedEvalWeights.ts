// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.323844,
    manaWeight: 12.350261,
    tappedManaWeight: 11.350261,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.772517,
    colorCoverageWeight: 22.526734,
    flexWeight: 5.906058,
    combatReserveWeight: 6.07788,
    landTempoWeight: 3.058473,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505523,
    graveyardReachFraction: 0.170154,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.619681,
    latentFlashCreatureDiscount: 0.819368,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769242,
    latent: Object.freeze({
        damage: 21.25415,
        cardAdvantage: 44.761149,
        lifeSwing: 7.630906,
        boardRemoval: 155.733311,
        ramp: 11.91982,
        evasion: 40,
        tempo: 53.731042,
        disruption: 130.699606,
        recursion: 135.380435,
        tokens: 0.500975,
        pump: 8.749633,
        protection: 60,
        recurrence: 8.141994,
    }),
});
