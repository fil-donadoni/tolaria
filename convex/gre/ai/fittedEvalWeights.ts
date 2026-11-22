// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.231949,
    manaWeight: 12.17681,
    tappedManaWeight: 11.17681,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.81282,
    colorCoverageWeight: 23.272255,
    flexWeight: 5.995699,
    combatReserveWeight: 6.052899,
    landTempoWeight: 3.04053,
    deckingWeight: 1.502024,
    poisonWeight: 2,
    energyWeight: 6.034941,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503795,
    graveyardReachFraction: 0.164691,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.636068,
    latentFlashCreatureDiscount: 0.763808,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.763562,
    costTaxWeight: 5.952368,
    latent: Object.freeze({
        damage: 21.714949,
        cardAdvantage: 45.04199,
        lifeSwing: 7.705214,
        boardRemoval: 157.225937,
        ramp: 11.961696,
        evasion: 40,
        tempo: 52.492946,
        disruption: 135.967189,
        recursion: 136.865423,
        tokens: 0.645341,
        pump: 8.855074,
        protection: 60,
        recurrence: 8.095122,
    }),
});
