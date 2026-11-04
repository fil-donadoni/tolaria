// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.300617,
    manaWeight: 12.303295,
    tappedManaWeight: 11.303295,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.027067,
    colorCoverageWeight: 21.300225,
    flexWeight: 6.200782,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.5,
    graveyardReachFraction: 0.16304,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.593932,
    latentFlashCreatureDiscount: 0.800432,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.779029,
    latent: Object.freeze({
        damage: 20.714361,
        cardAdvantage: 45.068768,
        lifeSwing: 7.424842,
        boardRemoval: 155.152028,
        ramp: 12,
        evasion: 40,
        tempo: 52.917254,
        disruption: 130,
        recursion: 140,
        tokens: 0.425,
        pump: 8.604017,
        protection: 60,
        recurrence: 8.226538,
    }),
});
