// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.281139,
    manaWeight: 12.289734,
    tappedManaWeight: 11.289734,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.765924,
    colorCoverageWeight: 22.885946,
    flexWeight: 5.912582,
    combatReserveWeight: 6.064191,
    landTempoWeight: 3.048645,
    deckingWeight: 1.502402,
    poisonWeight: 2,
    energyWeight: 6.041954,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504566,
    graveyardReachFraction: 0.169505,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.62536,
    latentFlashCreatureDiscount: 0.747583,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766183,
    costTaxWeight: 5.942438,
    latent: Object.freeze({
        damage: 21.574524,
        cardAdvantage: 45.069954,
        lifeSwing: 7.636517,
        boardRemoval: 156.79229,
        ramp: 11.960507,
        evasion: 40,
        tempo: 51.984501,
        disruption: 130.612873,
        recursion: 101.912003,
        tokens: 0.54866,
        pump: 8.829623,
        protection: 60,
        recurrence: 8.115193,
    }),
});
