// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.207351,
    manaWeight: 12.129806,
    tappedManaWeight: 11.129806,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.825981,
    colorCoverageWeight: 23.856038,
    flexWeight: 5.983147,
    combatReserveWeight: 6.045395,
    landTempoWeight: 3.036544,
    deckingWeight: 1.501849,
    poisonWeight: 2,
    energyWeight: 6.031489,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503382,
    graveyardReachFraction: 0.165869,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.687324,
    latentFlashCreatureDiscount: 0.78287,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76239,
    costTaxWeight: 5.957221,
    latent: Object.freeze({
        damage: 22.218771,
        cardAdvantage: 45.280537,
        lifeSwing: 7.744028,
        boardRemoval: 157.561827,
        ramp: 11.766272,
        evasion: 40,
        tempo: 52.781261,
        disruption: 135.428236,
        recursion: 136.755218,
        tokens: 0.812622,
        pump: 8.996314,
        protection: 60,
        recurrence: 8.081469,
    }),
});
