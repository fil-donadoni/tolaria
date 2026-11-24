// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.206962,
    manaWeight: 12.130765,
    tappedManaWeight: 11.130765,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.825563,
    colorCoverageWeight: 23.859013,
    flexWeight: 5.983277,
    combatReserveWeight: 6.045569,
    landTempoWeight: 3.036604,
    deckingWeight: 1.501852,
    poisonWeight: 2,
    energyWeight: 6.03154,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503388,
    graveyardReachFraction: 0.165938,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.684921,
    latentFlashCreatureDiscount: 0.782669,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76241,
    costTaxWeight: 5.957159,
    latent: Object.freeze({
        damage: 22.218465,
        cardAdvantage: 45.280335,
        lifeSwing: 7.743254,
        boardRemoval: 157.576929,
        ramp: 11.765887,
        evasion: 40,
        tempo: 52.775678,
        disruption: 135.436581,
        recursion: 136.762938,
        tokens: 0.812492,
        pump: 8.99586,
        protection: 60,
        recurrence: 8.081602,
    }),
});
