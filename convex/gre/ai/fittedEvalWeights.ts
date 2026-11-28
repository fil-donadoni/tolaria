// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.228642,
    manaWeight: 12.188775,
    tappedManaWeight: 11.188775,
    finiteManaUseWeight: 4,
    manaDevWeight: 12.096371,
    colorCoverageWeight: 23.917339,
    flexWeight: 5.991105,
    combatReserveWeight: 6.049144,
    landTempoWeight: 3.035949,
    deckingWeight: 1.5,
    poisonWeight: 2,
    energyWeight: 6.030987,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503277,
    graveyardReachFraction: 0.165733,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.684321,
    latentFlashCreatureDiscount: 0.85951,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.762386,
    costTaxWeight: 5.971682,
    costTaxLibraryWeight: 6,
    deploymentDelayDecay: 0.745907,
    latent: Object.freeze({
        damage: 22.860943,
        cardAdvantage: 44.762829,
        lifeSwing: 7.74625,
        boardRemoval: 159.828492,
        ramp: 11.760325,
        evasion: 40,
        tempo: 52.235921,
        disruption: 134.74248,
        recursion: 136.847465,
        tokens: 0.820828,
        pump: 8.988392,
        protection: 60,
        recurrence: 8.074741,
    }),
});
