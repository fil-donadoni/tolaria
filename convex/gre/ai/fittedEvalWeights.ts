// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.275038,
    manaWeight: 12.274947,
    tappedManaWeight: 11.274947,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.716721,
    colorCoverageWeight: 22.879095,
    flexWeight: 5.870602,
    combatReserveWeight: 6.064948,
    landTempoWeight: 3.049176,
    deckingWeight: 1.502428,
    poisonWeight: 2,
    energyWeight: 6.042412,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504616,
    graveyardReachFraction: 0.169706,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.624657,
    latentFlashCreatureDiscount: 0.748517,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766356,
    costTaxWeight: 5.941792,
    latent: Object.freeze({
        damage: 21.571798,
        cardAdvantage: 45.111121,
        lifeSwing: 7.632672,
        boardRemoval: 156.779498,
        ramp: 11.960043,
        evasion: 40,
        tempo: 51.951088,
        disruption: 130.616383,
        recursion: 101.578962,
        tokens: 0.543796,
        pump: 8.829771,
        protection: 60,
        recurrence: 8.116432,
    }),
});
