// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.223976,
    manaWeight: 12.172894,
    tappedManaWeight: 11.172894,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.824855,
    colorCoverageWeight: 23.858783,
    flexWeight: 5.983835,
    combatReserveWeight: 6.04534,
    landTempoWeight: 3.036427,
    deckingWeight: 1.501843,
    poisonWeight: 2,
    energyWeight: 6.031387,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503371,
    graveyardReachFraction: 0.165866,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.685201,
    latentFlashCreatureDiscount: 0.782942,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76235,
    costTaxWeight: 5.957169,
    latent: Object.freeze({
        damage: 22.217354,
        cardAdvantage: 45.272858,
        lifeSwing: 7.744459,
        boardRemoval: 157.204613,
        ramp: 11.767064,
        evasion: 40,
        tempo: 52.786483,
        disruption: 135.412291,
        recursion: 136.780607,
        tokens: 0.812599,
        pump: 8.995954,
        protection: 60,
        recurrence: 8.081191,
    }),
});
