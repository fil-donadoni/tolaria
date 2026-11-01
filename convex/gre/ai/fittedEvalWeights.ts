// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.453712,
    manaWeight: 12.916824,
    tappedManaWeight: 11.416824,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.072648,
    colorCoverageWeight: 22.041291,
    flexWeight: 6.86309,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.159623,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.708513,
    latentFlashCreatureDiscount: 0.807394,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.329269,
        cardAdvantage: 50.05825,
        lifeSwing: 7.584213,
        boardRemoval: 144.411311,
        ramp: 12,
        evasion: 40,
        tempo: 53.663252,
        disruption: 130,
        recursion: 140,
        tokens: 0.468145,
        pump: 7.10558,
        protection: 60,
        recurrence: 6.267957,
    }),
});
