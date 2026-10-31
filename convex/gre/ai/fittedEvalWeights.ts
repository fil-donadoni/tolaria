// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.667907,
    manaWeight: 13.089045,
    tappedManaWeight: 11.589045,
    finiteManaUseWeight: 4,
    manaDevWeight: 14.415707,
    colorCoverageWeight: 21.937392,
    flexWeight: 6.975347,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.159543,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.717932,
    latentFlashCreatureDiscount: 0.80858,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.506155,
        cardAdvantage: 46.965929,
        lifeSwing: 7.584858,
        boardRemoval: 160.470483,
        ramp: 12,
        evasion: 40,
        tempo: 53.653095,
        disruption: 130,
        recursion: 140,
        tokens: 0.465198,
        pump: 9.710593,
        protection: 60,
        recurrence: 6.241058,
    }),
});
