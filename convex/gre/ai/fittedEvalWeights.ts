// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.312013,
    manaWeight: 12.313693,
    tappedManaWeight: 11.313693,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.779341,
    colorCoverageWeight: 22.563621,
    flexWeight: 5.913984,
    combatReserveWeight: 6.075069,
    landTempoWeight: 3.056566,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505316,
    graveyardReachFraction: 0.169563,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.621668,
    latentFlashCreatureDiscount: 0.820721,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.768733,
    costTaxWeight: 5.932786,
    latent: Object.freeze({
        damage: 21.484982,
        cardAdvantage: 44.700338,
        lifeSwing: 7.600012,
        boardRemoval: 156.455766,
        ramp: 11.954309,
        evasion: 40,
        tempo: 53.775103,
        disruption: 130.677472,
        recursion: 135.536079,
        tokens: 0.510553,
        pump: 8.757909,
        protection: 60,
        recurrence: 8.134473,
    }),
});
