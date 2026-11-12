// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.32576,
    manaWeight: 12.354204,
    tappedManaWeight: 11.354204,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.673521,
    colorCoverageWeight: 22.541311,
    flexWeight: 5.895198,
    combatReserveWeight: 6.078294,
    landTempoWeight: 3.058787,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505552,
    graveyardReachFraction: 0.169951,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.619386,
    latentFlashCreatureDiscount: 0.81928,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769338,
    latent: Object.freeze({
        damage: 21.249569,
        cardAdvantage: 44.664249,
        lifeSwing: 7.628616,
        boardRemoval: 155.69718,
        ramp: 11.919459,
        evasion: 40,
        tempo: 53.72395,
        disruption: 130.69153,
        recursion: 135.380971,
        tokens: 0.499452,
        pump: 8.706847,
        protection: 60,
        recurrence: 8.142764,
    }),
});
