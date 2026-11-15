// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.303574,
    manaWeight: 12.296457,
    tappedManaWeight: 11.296457,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.785458,
    colorCoverageWeight: 22.602518,
    flexWeight: 5.916229,
    combatReserveWeight: 6.072749,
    landTempoWeight: 3.054913,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.50516,
    graveyardReachFraction: 0.169051,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.623564,
    latentFlashCreatureDiscount: 0.821768,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.768201,
    costTaxWeight: 5.934801,
    latent: Object.freeze({
        damage: 21.498154,
        cardAdvantage: 44.722337,
        lifeSwing: 7.610695,
        boardRemoval: 156.507388,
        ramp: 11.955661,
        evasion: 40,
        tempo: 53.813333,
        disruption: 130.663363,
        recursion: 135.672266,
        tokens: 0.518803,
        pump: 8.807477,
        protection: 60,
        recurrence: 8.130515,
    }),
});
