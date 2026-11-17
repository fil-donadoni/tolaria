// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.274994,
    manaWeight: 12.273672,
    tappedManaWeight: 11.273672,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.717773,
    colorCoverageWeight: 22.878957,
    flexWeight: 5.897271,
    combatReserveWeight: 6.064786,
    landTempoWeight: 3.049071,
    deckingWeight: 1.50242,
    poisonWeight: 2,
    energyWeight: 6.04232,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504606,
    graveyardReachFraction: 0.169668,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.624767,
    latentFlashCreatureDiscount: 0.746909,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766321,
    costTaxWeight: 5.941931,
    latent: Object.freeze({
        damage: 21.571505,
        cardAdvantage: 45.070197,
        lifeSwing: 7.633475,
        boardRemoval: 156.772256,
        ramp: 11.960122,
        evasion: 40,
        tempo: 51.957919,
        disruption: 130.61217,
        recursion: 101.64477,
        tokens: 0.546405,
        pump: 8.828142,
        protection: 60,
        recurrence: 8.116195,
    }),
});
