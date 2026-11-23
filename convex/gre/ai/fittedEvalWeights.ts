// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.20738,
    manaWeight: 12.132654,
    tappedManaWeight: 11.132654,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.825587,
    colorCoverageWeight: 23.845701,
    flexWeight: 5.976083,
    combatReserveWeight: 6.045726,
    landTempoWeight: 3.036782,
    deckingWeight: 1.501848,
    poisonWeight: 2,
    energyWeight: 6.031694,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503402,
    graveyardReachFraction: 0.165996,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.685687,
    latentFlashCreatureDiscount: 0.77309,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.762478,
    costTaxWeight: 5.956689,
    latent: Object.freeze({
        damage: 22.245297,
        cardAdvantage: 45.06655,
        lifeSwing: 7.742369,
        boardRemoval: 157.041412,
        ramp: 11.764943,
        evasion: 40,
        tempo: 52.765533,
        disruption: 135.462295,
        recursion: 136.746818,
        tokens: 0.662751,
        pump: 8.876331,
        protection: 60,
        recurrence: 8.0817,
    }),
});
