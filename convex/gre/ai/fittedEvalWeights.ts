// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.24985,
    manaWeight: 12.215862,
    tappedManaWeight: 11.215862,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.798458,
    colorCoverageWeight: 23.213544,
    flexWeight: 5.995757,
    combatReserveWeight: 6.057661,
    landTempoWeight: 3.04401,
    deckingWeight: 1.502188,
    poisonWeight: 2,
    energyWeight: 6.037942,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504105,
    graveyardReachFraction: 0.165873,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.630293,
    latentFlashCreatureDiscount: 0.757898,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.764763,
    costTaxWeight: 5.9482,
    latent: Object.freeze({
        damage: 21.863522,
        cardAdvantage: 45.039632,
        lifeSwing: 7.680891,
        boardRemoval: 157.125935,
        ramp: 11.957825,
        evasion: 40,
        tempo: 52.274678,
        disruption: 136.448932,
        recursion: 136.592533,
        tokens: 0.63061,
        pump: 8.842658,
        protection: 60,
        recurrence: 8.101448,
    }),
});
