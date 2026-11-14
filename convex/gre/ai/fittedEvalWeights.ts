// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.317588,
    manaWeight: 12.338587,
    tappedManaWeight: 11.338587,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.776093,
    colorCoverageWeight: 22.536335,
    flexWeight: 5.908877,
    combatReserveWeight: 6.076842,
    landTempoWeight: 3.057724,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505452,
    graveyardReachFraction: 0.169929,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.620288,
    latentFlashCreatureDiscount: 0.819837,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769004,
    costTaxWeight: 5.931732,
    latent: Object.freeze({
        damage: 21.262799,
        cardAdvantage: 44.798796,
        lifeSwing: 7.635069,
        boardRemoval: 156.906293,
        ramp: 11.920792,
        evasion: 40,
        tempo: 53.748132,
        disruption: 130.692257,
        recursion: 135.442742,
        tokens: 0.504968,
        pump: 8.752881,
        protection: 60,
        recurrence: 8.140289,
    }),
});
