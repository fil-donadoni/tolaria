// nph — red cards (ADR 0043 colour split). New Phyrexia (2011) is the home
// set (earliest paper printing) for this Phyrexian-mana cube cluster (issue
// #696).
import { defineCard } from "../../types";

// Whipflare — {1}{R} Sorcery. "Whipflare deals 2 damage to each nonartifact
// creature." A Pyroclasm-shaped sweep (CR 120.3): `forEach` over battlefield
// creatures, filtered by `excludeType: "Artifact"` — "nonartifact" is a
// card-type exclusion (CR 205.2a), so an artifact creature is left out.
// hand-tail: {self} deals 2 damage to each nonartifact creature. (#8647)
export const whipflare = defineCard(() => ({
    id: "5a7e6c10-d066-4967-932f-5b6c8d74568b", // NPH 102
    rarity: "uncommon",
    name: "Whipflare",
    oracleText: "Whipflare deals 2 damage to each nonartifact creature.",
    manaCost: { X: 1, R: 1 },
    types: ["Sorcery"],
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", excludeType: "Artifact" },
            },
            effects: [{ op: "dealDamage", amount: 2, to: { ref: "$each" } }],
        },
    ],
}));
