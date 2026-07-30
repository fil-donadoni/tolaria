// Ladder pairing registry — registry-as-data (issue #1924, decision #1895 §1).
//
// Each row is one deck matchup the ladder plays; the run plan expands every row
// into paired games (both agent seat orders per seed), so deck strength cancels
// and agent strength remains. Adding a deck = adding 1–2 targeted rows here,
// never a cross product — cost is linear per row (decision #1895 §6: +1 row ≈
// +17% at the current pool; revisit the seed count past ~10 rows).
//
// `dynamics` tags are the registry's coverage contract (decision #1895 §1):
// point blunders are BLADE's job (every observed blunder becomes a blade
// scenario), while the ladder owns DYNAMICS coverage — when a blunder exposes a
// dynamic no row exercises (e.g. a sweeper on a developed board), add or adapt
// a deck that contains it. Dedicated non-preset ladder decks are legitimate.
//
// The starting six rows are the archetype pairings the decision-telemetry
// corpus runner already plays (issue #1893), so ladder JSONL doubles as more
// calibration corpus with zero extra design.

export type LadderPairing = {
    /** Preset deck id (convex/deckPresets.ts). */
    deckA: string;
    deckB: string;
    /** Gameplay dynamics this matchup exercises — the coverage ledger. */
    dynamics: string[];
};

export const LADDER_PAIRINGS: LadderPairing[] = [
    {
        deckA: "mono-red-burn",
        deckB: "mono-red-burn",
        dynamics: ["direct-damage", "race", "mirror"],
    },
    {
        deckA: "mono-red-burn",
        deckB: "white-weenie",
        dynamics: ["direct-damage", "go-wide", "anthem"],
    },
    {
        deckA: "white-weenie",
        deckB: "mono-green-stompy",
        dynamics: ["go-wide", "anthem", "big-creatures", "combat-blocks"],
    },
    {
        deckA: "mono-black",
        deckB: "channel-fireball",
        dynamics: ["discard", "removal", "combo", "life-payment"],
    },
    {
        deckA: "robots",
        deckB: "mono-green-stompy",
        dynamics: ["artifacts", "big-creatures", "combat-blocks"],
    },
    {
        deckA: "channel-fireball",
        deckB: "white-weenie",
        dynamics: ["combo", "life-payment", "go-wide", "reach-race"],
    },
];
