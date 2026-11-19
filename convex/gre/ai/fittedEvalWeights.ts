// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.270241,
    manaWeight: 12.263089,
    tappedManaWeight: 11.263089,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.722571,
    colorCoverageWeight: 22.899421,
    flexWeight: 5.898893,
    combatReserveWeight: 6.063469,
    landTempoWeight: 3.048129,
    deckingWeight: 1.502377,
    poisonWeight: 2,
    energyWeight: 6.041507,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504517,
    graveyardReachFraction: 0.169295,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.626057,
    latentFlashCreatureDiscount: 0.748504,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766015,
    costTaxWeight: 5.943072,
    latent: Object.freeze({
        damage: 21.578936,
        cardAdvantage: 45.072462,
        lifeSwing: 7.640179,
        boardRemoval: 156.802986,
        ramp: 11.960911,
        evasion: 40,
        tempo: 52.016962,
        disruption: 130.603428,
        recursion: 102.244613,
        tokens: 0.551422,
        pump: 8.83133,
        protection: 60,
        recurrence: 8.11395,
    }),
});
