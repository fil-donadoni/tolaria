// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.264951,
    manaWeight: 12.251171,
    tappedManaWeight: 11.251171,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.547937,
    colorCoverageWeight: 22.157483,
    flexWeight: 5.963013,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.50578,
    graveyardReachFraction: 0.170504,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.622752,
    latentFlashCreatureDiscount: 0.817298,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770117,
    latent: Object.freeze({
        damage: 21.264096,
        cardAdvantage: 44.5763,
        lifeSwing: 7.616258,
        boardRemoval: 155.435968,
        ramp: 11.915599,
        evasion: 40,
        tempo: 53.627976,
        disruption: 130.649936,
        recursion: 135.128829,
        tokens: 0.488004,
        pump: 8.696899,
        protection: 60,
        recurrence: 8.148122,
    }),
});
