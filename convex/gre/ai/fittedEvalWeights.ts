// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.294486,
    manaWeight: 12.304036,
    tappedManaWeight: 11.304036,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.577648,
    colorCoverageWeight: 22.633865,
    flexWeight: 5.935818,
    combatReserveWeight: 6.068544,
    landTempoWeight: 3.051661,
    deckingWeight: 1.50254,
    poisonWeight: 2,
    energyWeight: 6.04455,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504849,
    graveyardReachFraction: 0.168372,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.618626,
    latentFlashCreatureDiscount: 0.744182,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.767155,
    costTaxWeight: 5.938819,
    latent: Object.freeze({
        damage: 21.545625,
        cardAdvantage: 44.965829,
        lifeSwing: 7.630072,
        boardRemoval: 156.647503,
        ramp: 11.957765,
        evasion: 40,
        tempo: 51.792908,
        disruption: 130.603228,
        recursion: 135.990623,
        tokens: 0.530499,
        pump: 8.820848,
        protection: 60,
        recurrence: 8.122428,
    }),
});
