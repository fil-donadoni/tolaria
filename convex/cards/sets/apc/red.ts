// APC — red cards, split by colour per ADR 0043. The registry's
// `import * as apc from "./sets/apc"` resolves through apc/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import type { CardDefinition } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Goblin Ringleader — {3}{R} 2/2 Goblin with haste (CR 702.10) whose ETB
// (CR 603.6a) is the deck's whole engine: "reveal the top four cards of your
// library. Put all Goblin cards revealed this way into your hand and the rest
// on the bottom of your library in any order."
//
// `lookDistribute` with `look === take === 4` and a `subtype: "Goblin"`
// filter: the filter alone decides what is KEEP-eligible (issue #1266 — the
// non-matching cards can never be kept), and `optional: false` makes the keep
// EXACTLY the clamped count, i.e. every revealed Goblin. `reveal: "window"`
// is the printed "reveal the top four" (CR 701.20a — the whole window is
// public, not a private Impulse-style look). The default
// `destination: "library-bottom"` is the "rest on the bottom ... in any
// order" clause: the bottom ORDER stays the controller's pick (ADR 0026 — no
// `randomBottom`, which is the Narset "in a RANDOM order" template instead).
export const goblinRingleader: CardDefinition = {
    id: "b6b2cd77-9552-48b1-80cb-26966323c1ea", // APC 62
    rarity: "uncommon",
    name: "Goblin Ringleader",
    oracleText:
        "Haste\nWhen this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.",
    manaCost: { X: 3, R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 2,
    staticAbilities: ["haste"],
    triggeredAbilities: [
        enteredTrigger({
            id: "goblin-ringleader-dig",
            oracleText:
                "When this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.",
            scope: "self",
            effects: [
                {
                    op: "lookDistribute",
                    player: "controller",
                    look: 4,
                    take: 4,
                    keepTo: "hand",
                    filter: { subtype: "Goblin" },
                    optional: false,
                    reveal: "window",
                    prompt: "Put all Goblin cards revealed this way into your hand; the rest go on the bottom of your library in any order.",
                },
            ],
        }),
    ],
};

// Bloodfire Infusion — {2}{R} Aura. "Enchant creature you control / {R},
// Sacrifice enchanted creature: This Aura deals damage equal to the sacrificed
// creature's power to each creature."
//
// The cost leg is `sacrificeFilter` narrowed by `hostOfSource` (CR 303.4b —
// the permanent the Aura is attached to is the ENCHANTED one), so the victim is
// never chosen: the picker auto-resolves to the host. The damage reads the
// victim's power as last known information (CR 608.2h) off the cost snapshot,
// then hits every creature on the battlefield — the Aura being the source (it
// leaves as an SBA once its host is gone, CR 704.5m, but the ability on the
// stack keeps its last-known identity).
// hand-tail: {R}, Sacrifice enchanted creature: This Aura deals damage equal to the sacrificed creature's power to each creature. (#4319)
export const bloodfireInfusion: CardDefinition = {
    id: "2639e9b7-ed8c-48fd-a8b7-b99d8dad4bc0", // APC 57
    rarity: "common",
    name: "Bloodfire Infusion",
    oracleText:
        "Enchant creature you control\n{R}, Sacrifice enchanted creature: This Aura deals damage equal to the sacrificed creature's power to each creature.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    subtypes: ["Aura"],
    // CR 303.4a — "Enchant creature you control": the Aura spell targets, and
    // the `controller` filter is what makes it the caster's own creature.
    targetRequirement: { type: "Creature", count: 1, controller: "you" },
    activatedAbilities: [
        {
            id: "bloodfire-infusion-sweep",
            oracleText:
                "{R}, Sacrifice enchanted creature: This Aura deals damage equal to the sacrificed creature's power to each creature.",
            cost: {
                mana: { R: 1 },
                sacrificeFilter: { types: "Creature", hostOfSource: true },
            },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        {
                            op: "dealDamage",
                            amount: { sacrificed: { read: "power" } },
                            to: { ref: "$each" },
                        },
                    ],
                },
            ],
        },
    ],
};

// Bloodfire Kavu — {2}{R}{R} 2/2 Kavu. "{R}, Sacrifice this creature: It deals
// 2 damage to each creature."
//
// The sacrifice is a cost (CR 118.1, CR 602.2b), so the Kavu is already in the
// graveyard when the ability resolves and "it" is its last known information
// (CR 608.2h) — the source of the damage. The sweep is `forEach` over
// battlefield creatures dealing 2 to each, the Pyroclasm shape (CR 120.3).
// hand-tail: {R}, Sacrifice this creature: It deals 2 damage to each creature. (#4324)
export const bloodfireKavu: CardDefinition = {
    id: "1442b1f3-8c2c-4553-906f-c864fcdc6ae5", // APC 58
    rarity: "uncommon",
    name: "Bloodfire Kavu",
    oracleText:
        "{R}, Sacrifice this creature: It deals 2 damage to each creature.",
    manaCost: { X: 2, R: 2 },
    types: ["Creature"],
    subtypes: ["Kavu"],
    power: 2,
    toughness: 2,
    activatedAbilities: [
        {
            id: "bloodfire-kavu-sweep",
            oracleText:
                "{R}, Sacrifice this creature: It deals 2 damage to each creature.",
            cost: { mana: { R: 1 }, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature" },
                    },
                    effects: [
                        { op: "dealDamage", amount: 2, to: { ref: "$each" } },
                    ],
                },
            ],
        },
    ],
};
