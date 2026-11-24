// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.207269,
    manaWeight: 12.131438,
    tappedManaWeight: 11.131438,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.825301,
    colorCoverageWeight: 23.85884,
    flexWeight: 5.983261,
    combatReserveWeight: 6.045645,
    landTempoWeight: 3.036663,
    deckingWeight: 1.501855,
    poisonWeight: 2,
    energyWeight: 6.031591,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503393,
    graveyardReachFraction: 0.165962,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.684848,
    latentFlashCreatureDiscount: 0.782585,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76243,
    costTaxWeight: 5.957089,
    latent: Object.freeze({
        damage: 22.218759,
        cardAdvantage: 45.28072,
        lifeSwing: 7.742865,
        boardRemoval: 157.575579,
        ramp: 11.765501,
        evasion: 40,
        tempo: 52.772043,
        disruption: 135.445004,
        recursion: 136.75731,
        tokens: 0.81243,
        pump: 8.99584,
        protection: 60,
        recurrence: 8.081729,
    }),
});
