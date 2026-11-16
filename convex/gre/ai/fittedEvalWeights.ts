// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.298804,
    manaWeight: 12.314897,
    tappedManaWeight: 11.314897,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.585992,
    colorCoverageWeight: 22.656959,
    flexWeight: 5.92405,
    combatReserveWeight: 6.066959,
    landTempoWeight: 3.050616,
    deckingWeight: 1.502492,
    poisonWeight: 2,
    energyWeight: 6.04365,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.50475,
    graveyardReachFraction: 0.169326,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.622144,
    latentFlashCreatureDiscount: 0.746099,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766819,
    costTaxWeight: 5.940056,
    latent: Object.freeze({
        damage: 21.55645,
        cardAdvantage: 44.962363,
        lifeSwing: 7.640186,
        boardRemoval: 156.676609,
        ramp: 11.95871,
        evasion: 40,
        tempo: 51.860673,
        disruption: 130.597626,
        recursion: 135.974545,
        tokens: 0.536084,
        pump: 8.824804,
        protection: 60,
        recurrence: 8.119903,
    }),
});
