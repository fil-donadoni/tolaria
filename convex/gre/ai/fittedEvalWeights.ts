// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.317214,
    manaWeight: 12.338544,
    tappedManaWeight: 11.338544,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.77611,
    colorCoverageWeight: 22.536461,
    flexWeight: 5.908853,
    combatReserveWeight: 6.076844,
    landTempoWeight: 3.057724,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505452,
    graveyardReachFraction: 0.169901,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.620258,
    latentFlashCreatureDiscount: 0.819834,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769004,
    costTaxWeight: 5.931732,
    latent: Object.freeze({
        damage: 21.263686,
        cardAdvantage: 44.80003,
        lifeSwing: 7.593114,
        boardRemoval: 156.906474,
        ramp: 11.953204,
        evasion: 40,
        tempo: 53.748095,
        disruption: 130.687762,
        recursion: 135.437273,
        tokens: 0.504967,
        pump: 8.752874,
        protection: 60,
        recurrence: 8.140277,
    }),
});
