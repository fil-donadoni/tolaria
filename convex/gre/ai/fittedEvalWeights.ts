// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.295501,
    manaWeight: 12.329905,
    tappedManaWeight: 11.329905,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.542324,
    colorCoverageWeight: 22.147008,
    flexWeight: 5.938927,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505826,
    graveyardReachFraction: 0.170753,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.618433,
    latentFlashCreatureDiscount: 0.817036,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770275,
    latent: Object.freeze({
        damage: 21.256213,
        cardAdvantage: 44.566453,
        lifeSwing: 7.612581,
        boardRemoval: 155.485981,
        ramp: 11.915015,
        evasion: 40,
        tempo: 53.610085,
        disruption: 130.660548,
        recursion: 135.123095,
        tokens: 0.485407,
        pump: 8.693318,
        protection: 60,
        recurrence: 8.149403,
    }),
});
