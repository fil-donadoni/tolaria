// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.26971,
    manaWeight: 12.261978,
    tappedManaWeight: 11.261978,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.723068,
    colorCoverageWeight: 22.901588,
    flexWeight: 5.882884,
    combatReserveWeight: 6.06333,
    landTempoWeight: 3.048025,
    deckingWeight: 1.502372,
    poisonWeight: 2,
    energyWeight: 6.041418,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504508,
    graveyardReachFraction: 0.169253,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.626207,
    latentFlashCreatureDiscount: 0.748699,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.765982,
    costTaxWeight: 5.943192,
    latent: Object.freeze({
        damage: 21.579978,
        cardAdvantage: 45.072996,
        lifeSwing: 7.640909,
        boardRemoval: 156.815014,
        ramp: 11.961033,
        evasion: 40,
        tempo: 52.023289,
        disruption: 130.604377,
        recursion: 102.312249,
        tokens: 0.551961,
        pump: 8.831664,
        protection: 60,
        recurrence: 8.1137,
    }),
});
