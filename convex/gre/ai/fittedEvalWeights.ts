// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.221684,
    manaWeight: 12.167807,
    tappedManaWeight: 11.167807,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.826674,
    colorCoverageWeight: 23.859986,
    flexWeight: 5.983934,
    combatReserveWeight: 6.044814,
    landTempoWeight: 3.036019,
    deckingWeight: 1.501823,
    poisonWeight: 2,
    energyWeight: 6.031036,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503333,
    graveyardReachFraction: 0.165703,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.685702,
    latentFlashCreatureDiscount: 0.783517,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.762213,
    costTaxWeight: 5.957655,
    latent: Object.freeze({
        damage: 22.21534,
        cardAdvantage: 45.270308,
        lifeSwing: 7.747123,
        boardRemoval: 157.215893,
        ramp: 11.769705,
        evasion: 40,
        tempo: 52.811365,
        disruption: 135.35457,
        recursion: 136.819017,
        tokens: 0.81302,
        pump: 8.996086,
        protection: 60,
        recurrence: 8.080325,
    }),
});
