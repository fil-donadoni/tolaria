// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.32675,
    manaWeight: 12.356369,
    tappedManaWeight: 11.356369,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.675436,
    colorCoverageWeight: 22.29908,
    flexWeight: 5.910395,
    combatReserveWeight: 6.078502,
    landTempoWeight: 3.058928,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505566,
    graveyardReachFraction: 0.169996,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.619321,
    latentFlashCreatureDiscount: 0.818958,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769387,
    latent: Object.freeze({
        damage: 21.247668,
        cardAdvantage: 44.660306,
        lifeSwing: 7.627773,
        boardRemoval: 155.682251,
        ramp: 11.919058,
        evasion: 40,
        tempo: 53.720489,
        disruption: 130.67436,
        recursion: 135.367518,
        tokens: 0.498682,
        pump: 8.706169,
        protection: 60,
        recurrence: 8.143152,
    }),
});
