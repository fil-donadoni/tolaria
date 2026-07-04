// lrw — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Tarfire — "Tarfire deals 2 damage to any target." (CR 120.1 damage.)
// Kindred Instant — Goblin (CR 301.10 — a Kindred permanent-independent card
// carries the creature-type subtype without being a creature).
export const tarfire: CardDefinition = {
    id: "d13a898e-6a97-4fd9-980e-3bfd8d755386",
    rarity: "common",
    name: "Tarfire",
    oracleText: "Tarfire deals 2 damage to any target.",
    manaCost: { R: 1 },
    types: ["Instant", "Kindred"],
    subtypes: ["Goblin"],
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
};
