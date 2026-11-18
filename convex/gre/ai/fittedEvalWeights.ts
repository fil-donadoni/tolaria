// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.266626,
    manaWeight: 12.259998,
    tappedManaWeight: 11.259998,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.776695,
    colorCoverageWeight: 23.141657,
    flexWeight: 5.901268,
    combatReserveWeight: 6.063184,
    landTempoWeight: 3.047932,
    deckingWeight: 1.502368,
    poisonWeight: 2,
    energyWeight: 6.04133,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504498,
    graveyardReachFraction: 0.169221,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.626247,
    latentFlashCreatureDiscount: 0.748958,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.765949,
    costTaxWeight: 5.943305,
    latent: Object.freeze({
        damage: 21.58049,
        cardAdvantage: 45.073008,
        lifeSwing: 7.641632,
        boardRemoval: 156.818078,
        ramp: 11.969118,
        evasion: 40,
        tempo: 52.029828,
        disruption: 124.171924,
        recursion: 102.375216,
        tokens: 0.552529,
        pump: 8.832077,
        protection: 60,
        recurrence: 8.113465,
    }),
});
