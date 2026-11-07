// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.26519,
    manaWeight: 12.257602,
    tappedManaWeight: 11.257602,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.543722,
    colorCoverageWeight: 21.898093,
    flexWeight: 5.992536,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505841,
    graveyardReachFraction: 0.170448,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.625853,
    latentFlashCreatureDiscount: 0.81528,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770342,
    latent: Object.freeze({
        damage: 21.280777,
        cardAdvantage: 46.152521,
        lifeSwing: 7.610893,
        boardRemoval: 155.562056,
        ramp: 12.162823,
        evasion: 40,
        tempo: 53.61749,
        disruption: 130.595908,
        recursion: 134.969697,
        tokens: 0.485568,
        pump: 8.683241,
        protection: 60,
        recurrence: 8.149461,
    }),
});
