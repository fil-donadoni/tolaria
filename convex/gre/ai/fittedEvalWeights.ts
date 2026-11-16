// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.291446,
    manaWeight: 12.297446,
    tappedManaWeight: 11.297446,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.581976,
    colorCoverageWeight: 22.648534,
    flexWeight: 5.936407,
    combatReserveWeight: 6.067722,
    landTempoWeight: 3.051076,
    deckingWeight: 1.502513,
    poisonWeight: 2,
    energyWeight: 6.044046,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504794,
    graveyardReachFraction: 0.168184,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.619399,
    latentFlashCreatureDiscount: 0.74514,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766966,
    costTaxWeight: 5.939529,
    latent: Object.freeze({
        damage: 21.550296,
        cardAdvantage: 44.96957,
        lifeSwing: 7.633943,
        boardRemoval: 156.666762,
        ramp: 11.958258,
        evasion: 40,
        tempo: 51.82959,
        disruption: 130.598607,
        recursion: 136.037678,
        tokens: 0.533584,
        pump: 8.822799,
        protection: 60,
        recurrence: 8.121032,
    }),
});
