// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.275533,
    manaWeight: 12.274873,
    tappedManaWeight: 11.274873,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.71723,
    colorCoverageWeight: 22.876634,
    flexWeight: 5.897088,
    combatReserveWeight: 6.064936,
    landTempoWeight: 3.049178,
    deckingWeight: 1.502425,
    poisonWeight: 2,
    energyWeight: 6.042412,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504616,
    graveyardReachFraction: 0.16971,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.624622,
    latentFlashCreatureDiscount: 0.746729,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766355,
    costTaxWeight: 5.941801,
    latent: Object.freeze({
        damage: 21.570665,
        cardAdvantage: 45.069932,
        lifeSwing: 7.632715,
        boardRemoval: 156.768787,
        ramp: 11.960033,
        evasion: 40,
        tempo: 51.951217,
        disruption: 130.613156,
        recursion: 101.576926,
        tokens: 0.545837,
        pump: 8.827781,
        protection: 60,
        recurrence: 8.11645,
    }),
});
