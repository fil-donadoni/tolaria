// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.307827,
    manaWeight: 12.317402,
    tappedManaWeight: 11.317402,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.051996,
    colorCoverageWeight: 21.23497,
    flexWeight: 6.208985,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.16324,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.59169,
    latentFlashCreatureDiscount: 0.799365,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.594445,
        cardAdvantage: 44.958975,
        lifeSwing: 7.417734,
        boardRemoval: 155.125757,
        ramp: 12,
        evasion: 40,
        tempo: 52.861266,
        disruption: 130,
        recursion: 140,
        tokens: 0.425,
        pump: 8.593817,
        protection: 60,
        recurrence: 8.256321,
    }),
});
