// dka — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Faithless Looting — {R} Sorcery. "Draw two cards, then discard two cards."
// with Flashback {2}{R} (CR 702.34 — cast from the graveyard for the flashback
// cost, then exile it). The rummage is a plain DSL loot: draw two (CR 121.6),
// then a mandatory two-card hand discard (CR 701.9 — the choice Op clamps to
// hand size). The interpreter checkpoints the Op index, so the draw runs once
// and the discard choice suspends without re-drawing. Flashback is the engine
// capability (convex/gre/flashback.ts) — the on-resolution effect is DSL like
// any free card; the `flashback` field carries the alternative cost.
export const faithlessLooting: CardDefinition = {
    id: "a1b0da17-d595-441d-811c-a2d28d2bb232",
    rarity: "common",
    name: "Faithless Looting",
    oracleText: "Draw two cards, then discard two cards.\nFlashback {2}{R}",
    manaCost: { R: 1 },
    types: ["Sorcery"],
    flashback: { X: 2, R: 1 },
    effects: [
        { op: "draw", player: "controller", count: 2 },
        {
            op: "choice",
            kind: "discard-hand",
            player: "controller",
            zone: "hand",
            count: 2,
            prompt: "Discard two cards.",
            bind: "$discards",
        },
        { op: "discard", player: "controller", cards: { ref: "$discards" } },
    ],
};
