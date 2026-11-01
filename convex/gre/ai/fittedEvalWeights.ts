// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.514434,
    manaWeight: 13.24058,
    tappedManaWeight: 11.74058,
    finiteManaUseWeight: 4,
    manaDevWeight: 12.677022,
    colorCoverageWeight: 22.06788,
    flexWeight: 6.935254,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.158844,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.642348,
    latentFlashCreatureDiscount: 0.824032,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.216075,
        cardAdvantage: 31.181487,
        lifeSwing: 7.598777,
        boardRemoval: 165.831555,
        ramp: 12,
        evasion: 40,
        tempo: 53.561097,
        disruption: 130,
        recursion: 140,
        tokens: 0.463452,
        pump: 7.66741,
        protection: 60,
        recurrence: 4,
    }),
});
