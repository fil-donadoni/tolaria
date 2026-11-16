// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.281989,
    manaWeight: 12.283418,
    tappedManaWeight: 11.283418,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.592738,
    colorCoverageWeight: 22.676539,
    flexWeight: 5.869085,
    combatReserveWeight: 6.06586,
    landTempoWeight: 3.049829,
    deckingWeight: 1.502456,
    poisonWeight: 2,
    energyWeight: 6.042975,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504677,
    graveyardReachFraction: 0.16995,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.623856,
    latentFlashCreatureDiscount: 0.747407,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766567,
    costTaxWeight: 5.941011,
    latent: Object.freeze({
        damage: 21.566781,
        cardAdvantage: 45.11142,
        lifeSwing: 7.628038,
        boardRemoval: 156.736855,
        ramp: 11.959263,
        evasion: 40,
        tempo: 51.910204,
        disruption: 130.596679,
        recursion: 101.167178,
        tokens: 0.540312,
        pump: 8.827498,
        protection: 60,
        recurrence: 8.11798,
    }),
});
