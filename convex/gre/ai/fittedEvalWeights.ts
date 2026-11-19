// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.273954,
    manaWeight: 12.266831,
    tappedManaWeight: 11.266831,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.780229,
    colorCoverageWeight: 23.133882,
    flexWeight: 5.994613,
    combatReserveWeight: 6.064154,
    landTempoWeight: 3.048558,
    deckingWeight: 1.502397,
    poisonWeight: 2,
    energyWeight: 6.041864,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504557,
    graveyardReachFraction: 0.16739,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.622666,
    latentFlashCreatureDiscount: 0.747641,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766147,
    costTaxWeight: 5.942584,
    latent: Object.freeze({
        damage: 21.569008,
        cardAdvantage: 44.942045,
        lifeSwing: 7.65082,
        boardRemoval: 156.757938,
        ramp: 11.952758,
        evasion: 40,
        tempo: 51.988594,
        disruption: 137.071931,
        recursion: 136.241628,
        tokens: 0.549126,
        pump: 8.829466,
        protection: 60,
        recurrence: 8.115033,
    }),
});
