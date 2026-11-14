// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.318028,
    manaWeight: 12.325773,
    tappedManaWeight: 11.325773,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.775116,
    colorCoverageWeight: 22.53644,
    flexWeight: 5.912766,
    combatReserveWeight: 6.076815,
    landTempoWeight: 3.057724,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505452,
    graveyardReachFraction: 0.169911,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.620329,
    latentFlashCreatureDiscount: 0.819929,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769004,
    costTaxWeight: 5.931371,
    latent: Object.freeze({
        damage: 21.2619,
        cardAdvantage: 44.671609,
        lifeSwing: 7.593309,
        boardRemoval: 156.416733,
        ramp: 11.953382,
        evasion: 40,
        tempo: 53.748214,
        disruption: 130.687173,
        recursion: 135.442069,
        tokens: 0.504797,
        pump: 8.752935,
        protection: 60,
        recurrence: 8.140234,
    }),
});
