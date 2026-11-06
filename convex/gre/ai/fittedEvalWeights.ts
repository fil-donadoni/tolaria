// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.173407,
    manaWeight: 12.15242,
    tappedManaWeight: 11.15242,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.363949,
    colorCoverageWeight: 21.337603,
    flexWeight: 6.218607,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505817,
    graveyardReachFraction: 0.170342,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.626117,
    latentFlashCreatureDiscount: 0.814614,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770233,
    latent: Object.freeze({
        damage: 21.280953,
        cardAdvantage: 46.152464,
        lifeSwing: 7.612582,
        boardRemoval: 155.334393,
        ramp: 12,
        evasion: 40,
        tempo: 53.627624,
        disruption: 130,
        recursion: 134.991218,
        tokens: 0.487178,
        pump: 8.74094,
        protection: 60,
        recurrence: 8.148718,
    }),
});
