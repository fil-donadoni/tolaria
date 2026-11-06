// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.230313,
    manaWeight: 12.260185,
    tappedManaWeight: 11.260185,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.35567,
    colorCoverageWeight: 21.515588,
    flexWeight: 6.042641,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505844,
    graveyardReachFraction: 0.170424,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.625897,
    latentFlashCreatureDiscount: 0.81482,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.770341,
    latent: Object.freeze({
        damage: 21.280271,
        cardAdvantage: 46.156753,
        lifeSwing: 7.610823,
        boardRemoval: 155.467008,
        ramp: 12,
        evasion: 40,
        tempo: 53.617993,
        disruption: 130,
        recursion: 134.96746,
        tokens: 0.485547,
        pump: 8.683167,
        protection: 60,
        recurrence: 8.149474,
    }),
});
