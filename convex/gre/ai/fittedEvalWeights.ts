// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.30559,
    manaWeight: 12.312628,
    tappedManaWeight: 11.312628,
    finiteManaUseWeight: 4,
    manaDevWeight: 13.043636,
    colorCoverageWeight: 21.256965,
    flexWeight: 6.207111,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.5,
    graveyardReachFraction: 0.163141,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.592233,
    latentFlashCreatureDiscount: 0.799641,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.611056,
        cardAdvantage: 44.961093,
        lifeSwing: 7.422041,
        boardRemoval: 155.128313,
        ramp: 12,
        evasion: 40,
        tempo: 52.879803,
        disruption: 130,
        recursion: 140,
        tokens: 0.425,
        pump: 8.597195,
        protection: 60,
        recurrence: 8.253992,
    }),
});
