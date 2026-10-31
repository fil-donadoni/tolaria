// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.673106,
    manaWeight: 13.085865,
    tappedManaWeight: 11.585865,
    finiteManaUseWeight: 4,
    manaDevWeight: 14.410199,
    colorCoverageWeight: 21.94633,
    flexWeight: 6.975053,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardReachFraction: 0.159592,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.703222,
    latentFlashCreatureDiscount: 0.808743,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.75,
    latent: Object.freeze({
        damage: 19.497702,
        cardAdvantage: 46.924911,
        lifeSwing: 7.582167,
        boardRemoval: 160.586826,
        ramp: 12,
        evasion: 40,
        tempo: 53.633991,
        disruption: 130,
        recursion: 140,
        tokens: 0.465448,
        pump: 9.698007,
        protection: 60,
        recurrence: 6.245833,
    }),
});
