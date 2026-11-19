// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.272072,
    manaWeight: 12.264479,
    tappedManaWeight: 11.264479,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.78098,
    colorCoverageWeight: 23.140479,
    flexWeight: 5.996091,
    combatReserveWeight: 6.063698,
    landTempoWeight: 3.04835,
    deckingWeight: 1.502392,
    poisonWeight: 2,
    energyWeight: 6.041685,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504508,
    graveyardReachFraction: 0.167311,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.6238,
    latentFlashCreatureDiscount: 0.750783,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766192,
    costTaxWeight: 5.94299,
    latent: Object.freeze({
        damage: 21.852618,
        cardAdvantage: 45.025941,
        lifeSwing: 7.651476,
        boardRemoval: 157.00716,
        ramp: 11.95289,
        evasion: 40,
        tempo: 52.002594,
        disruption: 137.043437,
        recursion: 136.248106,
        tokens: 0.612843,
        pump: 8.827307,
        protection: 60,
        recurrence: 8.111249,
    }),
});
