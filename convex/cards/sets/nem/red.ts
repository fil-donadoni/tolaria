// NEM — red cards, split by colour per ADR 0043. The registry's
// `import * as nem from "./sets/nem"` resolves through nem/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";

// Seal of Fire — "Sacrifice this enchantment: It deals 2 damage to any
// target." A "Seal" permanent: it enters as an Enchantment and stores a
// one-shot removal spell, cashed in by sacrificing itself as an activation
// cost (CR 602.1 / 701.21 sacrifice) with no mana and no tap — activatable
// any time you have priority. The sacrifice of THIS source is `cost.sacrifice`
// (distinct from `sacrificeFilter`, which sacrifices a chosen matching
// permanent — Goblin Bombardment). DSL-first: the effect is a single
// `dealDamage` Op to the announced any-target (CR 120.1). The source is
// removed to the graveyard at cost payment, before the ability resolves off
// its stack-item clone.
export const sealOfFire: CardDefinition = {
    id: "37eaf1f6-4bdc-4669-9a15-50b65e016ccf",
    rarity: "common",
    name: "Seal of Fire",
    oracleText: "Sacrifice this enchantment: It deals 2 damage to any target.",
    manaCost: { R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "seal-of-fire-sac",
            oracleText:
                "Sacrifice this enchantment: It deals 2 damage to any target.",
            cost: { sacrifice: true },
            useStack: true,
            targetRequirement: { type: "any", count: 1 },
            effects: [{ op: "dealDamage", amount: 2, to: { target: 0 } }],
        },
    ],
};

// Arc Mage — {2}{R} 2/2 Human Spellshaper. "{2}{R}, {T}, Discard a card: This
// creature deals 2 damage divided as you choose among one or two targets." (CR
// 601.2d / 120.4 divide-as-you-choose on an ACTIVATED ability.) The "Discard a
// card" leg is `cost.discardFilter` with a match-all filter (`{}` matches every
// hand card) — the same player-choice discard cost shape as Survival of the
// Fittest (exo). `divideAsChosen.total` drives the client per-target stepper
// UI; the open-ended `{ min: 1 }` count is capped at the 2-point total by the
// engine (each target needs ≥ 1).
//
// DSL-first (ADR 0045): the `dealDamageDividedAsChosen` Op (CR 601.2d / 120.4)
// reads the announced per-target split off the ability's stack item; `total`
// mirrors `divideAsChosen.total`.
export const arcMage: CardDefinition = {
    id: "62982dab-4c27-45b3-9740-38fec3df7226", // NEM 77
    rarity: "uncommon",
    name: "Arc Mage",
    oracleText:
        "{2}{R}, {T}, Discard a card: This creature deals 2 damage divided as you choose among one or two targets.",
    manaCost: { X: 2, R: 1 },
    types: ["Creature"],
    subtypes: ["Human", "Spellshaper"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "arc-mage-bolt",
            oracleText:
                "{2}{R}, {T}, Discard a card: This creature deals 2 damage divided as you choose among one or two targets.",
            cost: {
                mana: { X: 2, R: 1 },
                tap: true,
                discardFilter: { filter: {}, count: 1 },
            },
            useStack: true,
            targetRequirement: {
                type: "any",
                count: { min: 1 },
                divideAsChosen: { total: 2 },
            },
            effects: [{ op: "dealDamageDividedAsChosen", total: 2 }],
        },
    ],
};
