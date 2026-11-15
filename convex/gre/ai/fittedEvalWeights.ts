// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.305709,
    manaWeight: 12.30837,
    tappedManaWeight: 11.30837,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.884229,
    colorCoverageWeight: 22.660949,
    flexWeight: 5.919801,
    combatReserveWeight: 6.068996,
    landTempoWeight: 3.052234,
    deckingWeight: 1.5,
    poisonWeight: 2,
    energyWeight: 6.045067,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504903,
    graveyardReachFraction: 0.168492,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.626743,
    latentFlashCreatureDiscount: 0.823524,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.767356,
    costTaxWeight: 5.938033,
    latent: Object.freeze({
        damage: 21.557619,
        cardAdvantage: 44.754199,
        lifeSwing: 7.628595,
        boardRemoval: 156.622466,
        ramp: 11.957981,
        evasion: 40,
        tempo: 53.874835,
        disruption: 130.652971,
        recursion: 135.87455,
        tokens: 0.532344,
        pump: 8.816615,
        protection: 60,
        recurrence: 8.123638,
    }),
});
