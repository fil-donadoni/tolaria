// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.315039,
    manaWeight: 12.272147,
    tappedManaWeight: 11.272147,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.743196,
    colorCoverageWeight: 22.463326,
    flexWeight: 5.953893,
    combatReserveWeight: 6.080009,
    landTempoWeight: 3.060518,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505691,
    graveyardReachFraction: 0.170691,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.623445,
    latentFlashCreatureDiscount: 0.81824,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76999,
    costTaxWeight: 6.004903,
    latent: Object.freeze({
        damage: 21.434749,
        cardAdvantage: 43.718874,
        lifeSwing: 7.577686,
        boardRemoval: 120.701223,
        ramp: 11.952317,
        evasion: 40,
        tempo: 53.692614,
        disruption: 130.697375,
        recursion: 135.195117,
        tokens: 0.481412,
        pump: 8.861155,
        protection: 60,
        recurrence: 8.138991,
    }),
});
