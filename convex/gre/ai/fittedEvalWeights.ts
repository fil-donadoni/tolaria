// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.304971,
    manaWeight: 12.31262,
    tappedManaWeight: 11.31262,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.04338,
    colorCoverageWeight: 21.257279,
    flexWeight: 6.20435,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.5,
    graveyardReachFraction: 0.163236,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.592867,
    latentFlashCreatureDiscount: 0.799895,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.779477,
    latent: Object.freeze({
        damage: 20.698635,
        cardAdvantage: 45.067808,
        lifeSwing: 7.416236,
        boardRemoval: 155.147344,
        ramp: 12,
        evasion: 40,
        tempo: 52.881131,
        disruption: 130,
        recursion: 140,
        tokens: 0.425,
        pump: 8.59743,
        protection: 60,
        recurrence: 8.230356,
    }),
});
