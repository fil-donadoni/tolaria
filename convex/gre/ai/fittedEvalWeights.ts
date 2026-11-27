// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.232912,
    manaWeight: 12.18376,
    tappedManaWeight: 11.18376,
    finiteManaUseWeight: 4,
    manaDevWeight: 12.091831,
    colorCoverageWeight: 23.906473,
    flexWeight: 5.976807,
    combatReserveWeight: 6.044629,
    landTempoWeight: 3.036005,
    deckingWeight: 1.5,
    poisonWeight: 2,
    energyWeight: 6.031036,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503332,
    graveyardReachFraction: 0.165719,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.689817,
    latentFlashCreatureDiscount: 0.863369,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.762216,
    costTaxWeight: 5.957628,
    latent: Object.freeze({
        damage: 22.224026,
        cardAdvantage: 45.1218,
        lifeSwing: 7.74804,
        boardRemoval: 157.237906,
        ramp: 11.759659,
        evasion: 40,
        tempo: 52.814714,
        disruption: 134.750687,
        recursion: 136.79658,
        tokens: 0.816651,
        pump: 8.993922,
        protection: 60,
        recurrence: 8.080248,
    }),
});
