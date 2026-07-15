// tsp — red cards (ADR 0043 colour split).
import type { CardDefinition } from "../../types";

// Grapeshot — {1}{R} Sorcery. "Grapeshot deals 1 damage to any target. Storm
// (When you cast this spell, copy it for each spell cast before it this
// turn. You may choose new targets for the copies.)" (CR 702.40 Storm, ADR
// 0052 + PRD #1041 — the any-target retarget path.)
// `staticAbilities: ["storm"]` drives the copy mechanism
// (`collectCastTriggers` / `resolveStormTrigger`, convex/gre/state.ts). The
// card's own effect is a plain DSL `dealDamage` Op on an announced "any"
// target — the exact shape Triskelion's ability already exercises
// (atq/colorless.ts), reused verbatim (per-Op test regime: no new Op).
export const grapeshot: CardDefinition = {
    id: "4ee33cb6-768e-44a0-b6f4-b8638aa84330",
    name: "Grapeshot",
    rarity: "common",
    oracleText:
        "Grapeshot deals 1 damage to any target.\nStorm (When you cast this spell, copy it for each spell cast before it this turn. You may choose new targets for the copies.)",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    staticAbilities: ["storm"],
    targetRequirement: { type: "any", count: 1 },
    effects: [{ op: "dealDamage", amount: 1, to: { target: 0 } }],
};

// Empty the Warrens — {3}{R} Sorcery. "Create two 1/1 red Goblin creature
// tokens. Storm (When you cast this spell, copy it for each spell cast
// before it this turn.)" (CR 702.40 Storm, ADR 0052 + PRD #1041 — the
// NO-RETARGET branch: the card has no target, so its copies never raise a
// copy-retarget prompt — the printed reminder text omits "You may choose new
// targets for the copies" for exactly this reason.) `staticAbilities:
// ["storm"]` drives the copy mechanism (`collectCastTriggers` /
// `resolveStormTrigger`). The card's own effect is a plain DSL `createToken`
// Op with `count: 2` — the exact shape Lingering Souls already exercises
// (dka/white.ts), reused verbatim (per-Op test regime: no new Op).
export const emptyTheWarrens: CardDefinition = {
    id: "952bb27c-c58a-478a-b637-eb4f7e1e0ab4",
    name: "Empty the Warrens",
    rarity: "common",
    oracleText:
        "Create two 1/1 red Goblin creature tokens.\nStorm (When you cast this spell, copy it for each spell cast before it this turn.)",
    manaCost: { X: 3, R: 1 },
    types: ["Sorcery"],
    staticAbilities: ["storm"],
    effects: [
        {
            op: "createToken",
            controller: "controller",
            count: 2,
            token: {
                name: "Goblin",
                types: ["Creature"],
                subtypes: ["Goblin"],
                power: 1,
                toughness: 1,
                colors: ["R"],
            },
        },
    ],
};
