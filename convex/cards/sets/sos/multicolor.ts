// SOS (Scourge) — multicolor cards, split by colour per ADR 0043. The
// registry's `import * as sos from "./sets/sos"` resolves through sos/index.ts.
// Modern Scryfall oracle text is authoritative (ADR 0004).

import type { CardDefinition } from "../../types";

// Traumatic Critique — {X}{U}{R} Instant. "Traumatic Critique deals X damage to
// any target. Draw two cards, then discard a card." CR 107.3 X cost (read via
// getX()), CR 115.4 "any target", CR 121.1 draw, CR 701.8 discard. Stepped
// resolution: the irreversible damage + draw run first, then the discard pick
// can suspend without re-running them (CR 608.2).
export const traumaticCritique: CardDefinition = {
    id: "2a812fa7-4599-4e25-97db-20ffc6bc0b26",
    rarity: "common",
    name: "Traumatic Critique",
    oracleText:
        "Traumatic Critique deals X damage to any target. Draw two cards, then discard a card.",
    manaCost: { X: "X", U: 1, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: "any", count: 1 },
    // Migrated resolveSteps()→effects[] (ADR 0045, #852): X damage to any target
    // (CR 120.1, chosen-cost `{ X: true }`) + draw two, then a `choice`-driven
    // discard of one (CR 701.8 — Jalum Tome loot shape). The choice Op suspends
    // resolution and resumes AT the choice (the interpreter's pre-order cursor
    // guarantees the irreversible damage + draw never re-run — CR 608.3), so the
    // two resolveSteps collapse into one script.
    effects: [
        { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        { op: "draw", player: "controller", count: 2 },
        {
            op: "choice",
            kind: "choose-hand-card",
            player: "controller",
            zone: "hand",
            count: 1,
            prompt: "Discard a card (Traumatic Critique).",
            bind: "$discard",
        },
        { op: "discard", player: "controller", cards: { ref: "$discard" } },
    ],
};
