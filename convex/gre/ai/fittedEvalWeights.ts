// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.264302,
    manaWeight: 12.257612,
    tappedManaWeight: 11.257612,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.543739,
    colorCoverageWeight: 21.898108,
    flexWeight: 5.992535,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505841,
    graveyardReachFraction: 0.170448,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.625851,
    latentFlashCreatureDiscount: 0.815278,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770342,
    latent: Object.freeze({
        damage: 21.280785,
        cardAdvantage: 46.15253,
        lifeSwing: 7.610891,
        boardRemoval: 155.561447,
        ramp: 12.162821,
        evasion: 40,
        tempo: 53.617495,
        disruption: 130.595783,
        recursion: 134.96963,
        tokens: 0.485569,
        pump: 8.683241,
        protection: 60,
        recurrence: 8.149461,
    }),
});
