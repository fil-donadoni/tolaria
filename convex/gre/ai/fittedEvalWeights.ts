// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.669337,
    manaWeight: 13.07972,
    tappedManaWeight: 11.57972,
    finiteManaUseWeight: 4,
    manaDevWeight: 14.397061,
    colorCoverageWeight: 21.959121,
    flexWeight: 6.969279,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.159539,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.703511,
    latentFlashCreatureDiscount: 0.809049,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.509486,
        cardAdvantage: 46.917847,
        lifeSwing: 7.584472,
        boardRemoval: 160.589297,
        ramp: 12,
        evasion: 40,
        tempo: 53.642526,
        disruption: 130,
        recursion: 140,
        tokens: 0.467277,
        pump: 9.694812,
        protection: 60,
        recurrence: 6.254849,
    }),
});
