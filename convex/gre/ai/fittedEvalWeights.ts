// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.291928,
    manaWeight: 12.297448,
    tappedManaWeight: 11.297448,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.581877,
    colorCoverageWeight: 22.6497,
    flexWeight: 5.936494,
    combatReserveWeight: 6.067781,
    landTempoWeight: 3.051076,
    deckingWeight: 1.502513,
    poisonWeight: 2,
    energyWeight: 6.044046,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504794,
    graveyardReachFraction: 0.168208,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.618394,
    latentFlashCreatureDiscount: 0.745077,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.766966,
    costTaxWeight: 5.939534,
    latent: Object.freeze({
        damage: 21.549623,
        cardAdvantage: 44.969202,
        lifeSwing: 7.633723,
        boardRemoval: 156.675402,
        ramp: 11.958259,
        evasion: 40,
        tempo: 51.828409,
        disruption: 130.598716,
        recursion: 136.045329,
        tokens: 0.533545,
        pump: 8.82255,
        protection: 60,
        recurrence: 8.121042,
    }),
});
