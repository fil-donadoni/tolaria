// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.298209,
    manaWeight: 12.285501,
    tappedManaWeight: 11.285501,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.78932,
    colorCoverageWeight: 22.627243,
    flexWeight: 5.917642,
    combatReserveWeight: 6.07128,
    landTempoWeight: 3.053864,
    deckingWeight: 1.5,
    poisonWeight: 2,
    energyWeight: 6.046467,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505061,
    graveyardReachFraction: 0.168724,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.624789,
    latentFlashCreatureDiscount: 0.822443,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.767863,
    costTaxWeight: 5.936079,
    latent: Object.freeze({
        damage: 21.506573,
        cardAdvantage: 44.735953,
        lifeSwing: 7.617509,
        boardRemoval: 156.541091,
        ramp: 11.95652,
        evasion: 40,
        tempo: 53.837552,
        disruption: 130.654263,
        recursion: 135.758494,
        tokens: 0.524096,
        pump: 8.811037,
        protection: 60,
        recurrence: 8.128002,
    }),
});
