// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.217587,
    manaWeight: 12.169115,
    tappedManaWeight: 11.169115,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.5185,
    colorCoverageWeight: 23.889683,
    flexWeight: 5.986706,
    combatReserveWeight: 6.046015,
    landTempoWeight: 3.035981,
    deckingWeight: 1.501815,
    poisonWeight: 2,
    energyWeight: 6.030987,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503445,
    graveyardReachFraction: 0.168545,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.666892,
    latentFlashCreatureDiscount: 0.782736,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.761752,
    costTaxWeight: 5.95778,
    latent: Object.freeze({
        damage: 20.728919,
        cardAdvantage: 45.198449,
        lifeSwing: 7.751328,
        boardRemoval: 157.283549,
        ramp: 11.605034,
        evasion: 40,
        tempo: 52.799261,
        disruption: 135.347199,
        recursion: 136.817697,
        tokens: 0.812924,
        pump: 8.926284,
        protection: 60,
        recurrence: 8.093308,
    }),
});
