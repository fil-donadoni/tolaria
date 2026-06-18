// Antiquities (ATQ) — the game's first artifact-centric expansion. All entries
// are new `Card Definition`s: Antiquities has no reprints of already-implemented
// cards, so there are no `Card Print` stubs to add. Modern Scryfall oracle text
// is authoritative (ADR 0004); the canonical card list, mana costs, and types
// are sourced from MTGJSON `ATQ.json`.
//
// This file is built in dependency-ordered slices (see PRD #269). THIS slice
// (#270) is the walking skeleton: two vanilla keyword artifact creatures that
// prove the full pipeline (registry → GRE → wire projection → UI) end-to-end
// before the rest of the set lands. Bronze Tablet (ante) is out of scope and
// is intentionally absent (consistent with ADR 0010).
//
// Generic mana is encoded as `X: n` (e.g. {3} → { X: 3 }); {0} is an empty
// mana cost `{}`.

import type { CardDefinition } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Vanilla / keyword artifact creatures (CR 702 — keywords map to
// `staticAbilities[]`; CR 301 — artifact creatures are both Artifact and
// Creature, affected by both artifact and creature rules)
// ─────────────────────────────────────────────────────────────────────────────

// Ornithopter — {0} Artifact Creature — Thopter, 0/2 with flying (CR 702.9).
// The classic free flyer; a zero-cost evasive blocker/chump.
export const ornithopter: CardDefinition = {
    id: "8b4f1f8f-2d2e-4f1a-9a1c-0f1e4d3c2b1a",
    name: "Ornithopter",
    oracleText: "Flying",
    manaCost: {},
    types: ["Artifact", "Creature"],
    subtypes: ["Thopter"],
    power: 0,
    toughness: 2,
    staticAbilities: ["flying"],
};

// Yotian Soldier — {3} Artifact Creature — Soldier, 1/4 with vigilance
// (CR 702.21). A durable attacker that stays back to block.
export const yotianSoldier: CardDefinition = {
    id: "6c3e2a7b-9d4f-4c8a-b2e1-7a5d8c9b0e2f",
    name: "Yotian Soldier",
    oracleText: "Vigilance",
    manaCost: { X: 3 },
    types: ["Artifact", "Creature"],
    subtypes: ["Soldier"],
    power: 1,
    toughness: 4,
    staticAbilities: ["vigilance"],
};
