// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.230908,
    manaWeight: 12.176841,
    tappedManaWeight: 11.176841,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.808663,
    colorCoverageWeight: 23.272391,
    flexWeight: 5.995696,
    combatReserveWeight: 6.052898,
    landTempoWeight: 3.04053,
    deckingWeight: 1.502024,
    poisonWeight: 2,
    energyWeight: 6.034941,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.503795,
    graveyardReachFraction: 0.164691,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.636065,
    latentFlashCreatureDiscount: 0.76381,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.763562,
    costTaxWeight: 5.952368,
    latent: Object.freeze({
        damage: 21.714958,
        cardAdvantage: 45.042075,
        lifeSwing: 7.705214,
        boardRemoval: 157.224589,
        ramp: 11.961691,
        evasion: 40,
        tempo: 52.492949,
        disruption: 135.966892,
        recursion: 136.865388,
        tokens: 0.645341,
        pump: 8.855071,
        protection: 60,
        recurrence: 8.095122,
    }),
});
