// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.280594,
    manaWeight: 12.288515,
    tappedManaWeight: 11.288515,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.766365,
    colorCoverageWeight: 22.888228,
    flexWeight: 5.912731,
    combatReserveWeight: 6.064045,
    landTempoWeight: 3.048541,
    deckingWeight: 1.502397,
    poisonWeight: 2,
    energyWeight: 6.041864,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504556,
    graveyardReachFraction: 0.169463,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.625504,
    latentFlashCreatureDiscount: 0.74776,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766149,
    costTaxWeight: 5.942565,
    latent: Object.freeze({
        damage: 21.575351,
        cardAdvantage: 45.070211,
        lifeSwing: 7.637262,
        boardRemoval: 156.795687,
        ramp: 11.960595,
        evasion: 40,
        tempo: 51.991061,
        disruption: 130.611885,
        recursion: 101.978655,
        tokens: 0.549218,
        pump: 8.829977,
        protection: 60,
        recurrence: 8.114943,
    }),
});
