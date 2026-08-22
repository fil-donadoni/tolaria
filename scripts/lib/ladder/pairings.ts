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
    /** Environment rung (issue #2689, decision #1895 §1): R0 = combat and
     *  racing (the starting six rows), R1 = instant-speed interaction and
     *  repeatable abilities, R2 = cube archetypes with combos. Selectable
     *  alone via `--rung` (scripts/lib/ladder/filter.ts) — a filter, not a
     *  renumbering: see that module's header. */
    rung: "R0" | "R1" | "R2";
};

// Coverage-ledger note: `combo-infinite` (Splinter Twin + Deceiver Exarch) is
// a KNOWN HOLE, not an oversight. ADR 0102 measured the activation is chosen
// 2/5 → 1/5 → 0/5 at 400/1200/4000 iterations because the payoff sits ~40
// plies past the search horizon — the dynamic cannot be measured until PRD
// #2687 (CR 732 loop shortcut) lands. The deck belongs to that slice, not to
// R2 here.
export const LADDER_PAIRINGS: LadderPairing[] = [
    {
        deckA: "mono-red-burn",
        deckB: "mono-red-burn",
        dynamics: ["direct-damage", "race", "mirror"],
        rung: "R0",
    },
    {
        deckA: "mono-red-burn",
        deckB: "white-weenie",
        dynamics: ["direct-damage", "go-wide", "anthem"],
        rung: "R0",
    },
    {
        deckA: "white-weenie",
        deckB: "mono-green-stompy",
        dynamics: ["go-wide", "anthem", "big-creatures", "combat-blocks"],
        rung: "R0",
    },
    {
        deckA: "mono-black",
        deckB: "channel-fireball",
        dynamics: ["discard", "removal", "combo", "life-payment"],
        rung: "R0",
    },
    {
        deckA: "robots",
        deckB: "mono-green-stompy",
        dynamics: ["artifacts", "big-creatures", "combat-blocks"],
        rung: "R0",
    },
    {
        deckA: "channel-fireball",
        deckB: "white-weenie",
        dynamics: ["combo", "life-payment", "go-wide", "reach-race"],
        rung: "R0",
    },
    // R1 — instant-speed interaction
    {
        deckA: "bg-sacrifice",
        deckB: "mono-black",
        dynamics: ["sac-outlet", "recursion", "discard", "removal"],
        rung: "R1",
    },
    {
        deckA: "bg-sacrifice",
        deckB: "uw-flash",
        dynamics: ["sac-outlet", "recursion", "counterspell", "flash"],
        rung: "R1",
    },
    {
        deckA: "uw-flash",
        deckB: "mono-red-burn",
        dynamics: ["flash", "counterspell", "direct-damage", "race"],
        rung: "R1",
    },
    {
        deckA: "uw-flash",
        deckB: "rg-kicker",
        dynamics: ["flash", "counterspell", "kicker", "activated-abilities"],
        rung: "R1",
    },
    {
        deckA: "rg-kicker",
        deckB: "mono-green-stompy",
        dynamics: [
            "kicker",
            "activated-abilities",
            "big-creatures",
            "combat-blocks",
        ],
        rung: "R1",
    },
    {
        deckA: "rg-kicker",
        deckB: "mono-u-tempo",
        dynamics: ["kicker", "bounce", "tempo"],
        rung: "R1",
    },
    {
        deckA: "mono-u-tempo",
        deckB: "white-weenie",
        dynamics: ["bounce", "tempo", "go-wide", "anthem"],
        rung: "R1",
    },
    {
        deckA: "mono-u-tempo",
        deckB: "bg-sacrifice",
        dynamics: ["bounce", "sac-outlet", "recursion"],
        rung: "R1",
    },
    // R2 — cube archetypes
    {
        deckA: "br-reanimator",
        deckB: "uw-control",
        dynamics: ["reanimation", "looting", "control", "sweeper"],
        rung: "R2",
    },
    {
        deckA: "br-reanimator",
        deckB: "mono-r-aggro",
        dynamics: ["reanimation", "looting", "aggro-burn", "race"],
        rung: "R2",
    },
    {
        deckA: "mono-r-aggro",
        deckB: "uw-control",
        dynamics: ["aggro-burn", "control", "sweeper"],
        rung: "R2",
    },
];
