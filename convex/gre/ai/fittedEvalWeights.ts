// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.221828,
    manaWeight: 12.161492,
    tappedManaWeight: 11.161492,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.813774,
    colorCoverageWeight: 23.847558,
    flexWeight: 5.982426,
    combatReserveWeight: 6.049013,
    landTempoWeight: 3.03935,
    deckingWeight: 1.501985,
    poisonWeight: 2,
    energyWeight: 6.033905,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503639,
    graveyardReachFraction: 0.166972,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.684137,
    latentFlashCreatureDiscount: 0.778999,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.763333,
    costTaxWeight: 5.95389,
    latent: Object.freeze({
        damage: 22.232561,
        cardAdvantage: 45.298651,
        lifeSwing: 7.725849,
        boardRemoval: 157.499737,
        ramp: 11.748053,
        evasion: 40,
        tempo: 52.610152,
        disruption: 135.824042,
        recursion: 136.486963,
        tokens: 0.809755,
        pump: 9.019885,
        protection: 60,
        recurrence: 8.087419,
    }),
});
