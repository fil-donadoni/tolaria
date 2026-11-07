// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.295822,
    manaWeight: 12.32812,
    tappedManaWeight: 11.32812,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.543934,
    colorCoverageWeight: 22.146021,
    flexWeight: 5.962757,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505809,
    graveyardReachFraction: 0.170599,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.622486,
    latentFlashCreatureDiscount: 0.817127,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770223,
    latent: Object.freeze({
        damage: 21.260459,
        cardAdvantage: 44.57111,
        lifeSwing: 7.614513,
        boardRemoval: 155.444124,
        ramp: 11.915173,
        evasion: 40,
        tempo: 53.619865,
        disruption: 130.655873,
        recursion: 135.103314,
        tokens: 0.486382,
        pump: 8.69531,
        protection: 60,
        recurrence: 8.148948,
    }),
});
