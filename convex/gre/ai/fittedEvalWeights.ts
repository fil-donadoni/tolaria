// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.301763,
    manaWeight: 12.275232,
    tappedManaWeight: 11.275232,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.52976,
    colorCoverageWeight: 22.521768,
    flexWeight: 5.972248,
    combatReserveWeight: 6.073986,
    landTempoWeight: 3.05589,
    deckingWeight: 1.502735,
    poisonWeight: 2,
    energyWeight: 6.048195,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.50525,
    graveyardReachFraction: 0.169649,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.618801,
    latentFlashCreatureDiscount: 0.737835,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76851,
    costTaxWeight: 6.004525,
    latent: Object.freeze({
        damage: 21.495736,
        cardAdvantage: 44.113621,
        lifeSwing: 7.60479,
        boardRemoval: 122.534157,
        ramp: 11.955219,
        evasion: 40,
        tempo: 51.535541,
        disruption: 130.625198,
        recursion: 135.636138,
        tokens: 0.499893,
        pump: 8.872757,
        protection: 60,
        recurrence: 8.128128,
    }),
});
