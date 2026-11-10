// GENERATED — never edit by hand (issue #7653). `bun run bot:refit` writes
// this file (`rewriteDefaultEvalWeights`, `convex/gre/ai/verdicts/weightsLiteral.ts`)
// and, on the base, `derive:sync` writes it after each merge in its one derive
// commit (ADR 0157 § Option 1b): a PR carries Bot code, never its refit —
// `check:derived-in-diff` refuses a diff that moves it, `land:ready` restores
// it to the merge-base. What it is and why it is a pure function of the tree:
// `DEFAULT_EVAL_WEIGHTS` in `./evalWeights.ts`.
export const FITTED_EVAL_WEIGHTS = Object.freeze({
    lifeWeight: 8,
    permanentWeight: 5.327542,
    manaWeight: 12.358028,
    tappedManaWeight: 11.358028,
    finiteManaUseWeight: 4,
    manaDevWeight: 11.674644,
    colorCoverageWeight: 22.294941,
    flexWeight: 5.910191,
    combatReserveWeight: 6.07872,
    landTempoWeight: 3.059082,
    deckingWeight: 1.5,
    poisonWeight: 2,
    graveyardEngineWeight: 60,
    graveyardEngineFraction: 0.505581,
    graveyardReachFraction: 0.170042,
    recoverableSweepFraction: 0.8,
    heldDifferentialFraction: 0.25,
    latentCreatureDiscount: 0.61916,
    latentFlashCreatureDiscount: 0.818857,
    cannotAttackShare: 0.75,
    cannotBlockShare: 0.769436,
    latent: Object.freeze({
        damage: 21.246002,
        cardAdvantage: 44.658123,
        lifeSwing: 7.626895,
        boardRemoval: 155.676815,
        ramp: 11.918846,
        evasion: 40,
        tempo: 53.716913,
        disruption: 130.675526,
        recursion: 135.35478,
        tokens: 0.497924,
        pump: 8.705416,
        protection: 60,
        recurrence: 8.143535,
    }),
});
