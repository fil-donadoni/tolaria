// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.667028,
    manaWeight: 13.07668,
    tappedManaWeight: 11.57668,
    finiteManaUseWeight: 4,
    manaDevWeight: 14.390561,
    colorCoverageWeight: 21.965465,
    flexWeight: 6.966418,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.159512,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.703653,
    latentFlashCreatureDiscount: 0.809199,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.515344,
        cardAdvantage: 46.914334,
        lifeSwing: 7.585615,
        boardRemoval: 160.590264,
        ramp: 12,
        evasion: 40,
        tempo: 53.646758,
        disruption: 130,
        recursion: 140,
        tokens: 0.468185,
        pump: 9.693235,
        protection: 60,
        recurrence: 6.259323,
    }),
});
