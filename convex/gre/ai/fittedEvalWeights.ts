// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.280552,
    manaWeight: 12.264434,
    tappedManaWeight: 11.264434,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.789402,
    colorCoverageWeight: 23.094524,
    flexWeight: 5.968081,
    combatReserveWeight: 6.063616,
    landTempoWeight: 3.048345,
    deckingWeight: 1.502338,
    poisonWeight: 2,
    energyWeight: 6.041685,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.50451,
    graveyardReachFraction: 0.167335,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.623706,
    latentFlashCreatureDiscount: 0.719368,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76618,
    costTaxWeight: 5.943086,
    latent: Object.freeze({
        damage: 21.824191,
        cardAdvantage: 44.300235,
        lifeSwing: 7.652335,
        boardRemoval: 157.197854,
        ramp: 11.953847,
        evasion: 40,
        tempo: 52.002231,
        disruption: 137.046345,
        recursion: 136.277811,
        tokens: 0.678861,
        pump: 8.75915,
        protection: 60,
        recurrence: 8.111599,
    }),
});
