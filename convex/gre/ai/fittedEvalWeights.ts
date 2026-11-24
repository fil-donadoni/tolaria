// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.207658,
    manaWeight: 12.130476,
    tappedManaWeight: 11.130476,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.82572,
    colorCoverageWeight: 23.855859,
    flexWeight: 5.983132,
    combatReserveWeight: 6.045471,
    landTempoWeight: 3.036604,
    deckingWeight: 1.501852,
    poisonWeight: 2,
    energyWeight: 6.03154,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503388,
    graveyardReachFraction: 0.165892,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.687253,
    latentFlashCreatureDiscount: 0.782787,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76241,
    costTaxWeight: 5.957151,
    latent: Object.freeze({
        damage: 22.219065,
        cardAdvantage: 45.280923,
        lifeSwing: 7.743641,
        boardRemoval: 157.56046,
        ramp: 11.765887,
        evasion: 40,
        tempo: 52.777641,
        disruption: 135.436633,
        recursion: 136.749588,
        tokens: 0.812561,
        pump: 8.996295,
        protection: 60,
        recurrence: 8.081595,
    }),
});
