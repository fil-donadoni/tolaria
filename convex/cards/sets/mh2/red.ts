// mh2 — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Mine Collapse — {3}{R} Instant. "If it's your turn, you may sacrifice a
// Mountain rather than pay this spell's mana cost. Mine Collapse deals 5 damage
// to target creature or planeswalker." (CR 118.9 alternative pitch cost —
// sacrifice a Mountain, gated on the your-turn condition; CR 701.16 sacrifice;
// CR 120.1 damage.)
//
// The alternative cost is a censusless CR 118.9 rules concept (no keyword name):
// the existing PERMANENT `action: "sacrifice"` leg (Fireblast's shape) narrowed
// to a single Mountain, plus a `condition: your-turn`. The effect is a single
// already-censused `dealDamage` Op to a creature-or-planeswalker target
// (ADR 0045, DSL-first).
export const mineCollapse: CardDefinition = {
    id: "56e2e8b5-660d-4469-a4fe-2367dfadb709", // MH2 135
    rarity: "common",
    name: "Mine Collapse",
    oracleText:
        "If it's your turn, you may sacrifice a Mountain rather than pay this spell's mana cost.\nMine Collapse deals 5 damage to target creature or planeswalker.",
    manaCost: { X: 3, R: 1 },
    types: ["Instant"],
    targetRequirement: { type: ["Creature", "Planeswalker"], count: 1 },
    alternativeCosts: [
        {
            id: "pitch-sacrifice-mountain",
            description: "Sacrifice a Mountain",
            action: "sacrifice",
            count: 1,
            filter: { subtypes: "Mountain" },
            condition: { kind: "your-turn" },
        },
    ],
    effects: [{ op: "dealDamage", amount: 5, to: { target: 0 } }],
};

// TODO(issue #679 stub — Fury needs Evoke (CR 702.74): mechanicsRegistry.ts
// lists it `status: "planned"` — same gap already flagged for Solitude
// (mh2/white.ts) and Subtlety (mh2/blue.ts). Evoke is integral to the card
// (its only realistic cast path in a Cube context), so — matching the
// Solitude/Subtlety precedent — the whole card stays a stub rather than
// shipping a hard-cast-only partial. Stop-and-issue per gre-development.md;
// tracked stub.
// export const fury: CardDefinition = {
//     id: "bd281158-8180-40b9-a5b7-03cfc712d81a",
//     name: "Fury",
//     rarity: "mythic",
//     manaCost: { X: 3, R: 2 },
//     types: ["Creature"],
//     subtypes: ["Elemental", "Incarnation"],
//     power: 3,
//     toughness: 3,
// };

export {};
