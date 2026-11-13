// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.322301,
    manaWeight: 12.347031,
    tappedManaWeight: 11.347031,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.77362,
    colorCoverageWeight: 22.533775,
    flexWeight: 5.906484,
    combatReserveWeight: 6.077455,
    landTempoWeight: 3.058171,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505494,
    graveyardReachFraction: 0.170062,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.620002,
    latentFlashCreatureDiscount: 0.819564,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769146,
    latent: Object.freeze({
        damage: 21.257406,
        cardAdvantage: 44.764954,
        lifeSwing: 7.632621,
        boardRemoval: 155.743773,
        ramp: 11.920234,
        evasion: 40,
        tempo: 53.738026,
        disruption: 130.697051,
        recursion: 135.405493,
        tokens: 0.502461,
        pump: 8.750922,
        protection: 60,
        recurrence: 8.141245,
    }),
});
