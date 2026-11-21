// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.271544,
    manaWeight: 12.263322,
    tappedManaWeight: 11.263322,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.781391,
    colorCoverageWeight: 23.142219,
    flexWeight: 5.996082,
    combatReserveWeight: 6.063554,
    landTempoWeight: 3.048247,
    deckingWeight: 1.502387,
    poisonWeight: 2,
    energyWeight: 6.041595,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504498,
    graveyardReachFraction: 0.167277,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.623946,
    latentFlashCreatureDiscount: 0.750949,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766158,
    costTaxWeight: 5.943114,
    latent: Object.freeze({
        damage: 21.85287,
        cardAdvantage: 45.026293,
        lifeSwing: 7.652172,
        boardRemoval: 157.009903,
        ramp: 11.953009,
        evasion: 40,
        tempo: 52.009075,
        disruption: 137.029349,
        recursion: 136.25638,
        tokens: 0.613259,
        pump: 8.827671,
        protection: 60,
        recurrence: 8.111016,
    }),
});
