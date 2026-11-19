// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.26766,
    manaWeight: 12.257421,
    tappedManaWeight: 11.257421,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.725142,
    colorCoverageWeight: 22.910401,
    flexWeight: 5.88372,
    combatReserveWeight: 6.062764,
    landTempoWeight: 3.04762,
    deckingWeight: 1.502353,
    poisonWeight: 2,
    energyWeight: 6.041068,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.504469,
    graveyardReachFraction: 0.169092,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.626774,
    latentFlashCreatureDiscount: 0.74939,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.76585,
    costTaxWeight: 5.943683,
    latent: Object.freeze({
        damage: 21.583189,
        cardAdvantage: 45.073923,
        lifeSwing: 7.643801,
        boardRemoval: 156.828249,
        ramp: 11.961372,
        evasion: 40,
        tempo: 52.048706,
        disruption: 130.600551,
        recursion: 102.571842,
        tokens: 0.55413,
        pump: 8.83304,
        protection: 60,
        recurrence: 8.112734,
    }),
});
