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

// Wild Research — {2}{R} Enchantment. Two activated abilities, each a tutor:
// "Search your library for an <enchantment|instant> card and reveal that card.
// Put it into your hand, then discard a card at random. Then shuffle."
// (CR 701.23a search — the library is hidden, so the player may find no card
// (CR 701.23b); CR 701.20a reveal; CR 701.9b random discard, which may pick
// the card just fetched; CR 701.24a shuffle, last.) Search → reveal → move →
// discard → shuffle in the printed order, so a card discarded at random is in
// the graveyard before the shuffle.
// hand-tail: {1}{U}: Search your library for an instant card and reveal that card. Put it into your hand, then discard a card at random. Then shuffle. (#4343)
export const wildResearch: CardDefinition = {
    id: "8f00e6f1-e854-40b0-855d-7e0d7d233850", // APC 72
    rarity: "rare",
    name: "Wild Research",
    oracleText:
        "{1}{W}: Search your library for an enchantment card and reveal that card. Put it into your hand, then discard a card at random. Then shuffle.\n{1}{U}: Search your library for an instant card and reveal that card. Put it into your hand, then discard a card at random. Then shuffle.",
    manaCost: { X: 2, R: 1 },
    types: ["Enchantment"],
    activatedAbilities: [
        {
            id: "wild-research-enchantment",
            oracleText:
                "{1}{W}: Search your library for an enchantment card and reveal that card. Put it into your hand, then discard a card at random. Then shuffle.",
            cost: { mana: { X: 1, W: 1 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Enchantment" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an enchantment card (or none).",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "discardAtRandom", player: "controller", count: 1 },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
        {
            id: "wild-research-instant",
            oracleText:
                "{1}{U}: Search your library for an instant card and reveal that card. Put it into your hand, then discard a card at random. Then shuffle.",
            cost: { mana: { X: 1, U: 1 } },
            useStack: true,
            effects: [
                {
                    op: "choice",
                    kind: "search-library",
                    player: "controller",
                    zone: "library",
                    filter: { type: "Instant" },
                    count: { min: 0, max: 1 },
                    prompt: "Search your library for an instant card (or none).",
                    bind: "$picked",
                },
                {
                    op: "reveal",
                    player: "controller",
                    cards: { ref: "$picked" },
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "library",
                    to: "hand",
                },
                { op: "discardAtRandom", player: "controller", count: 1 },
                { op: "libraryLook", action: "shuffle", player: "controller" },
            ],
        },
    ],
};

// Illuminate — {X}{R} Sorcery. "Kicker {2}{R} and/or {3}{U}. Illuminate deals X
// damage to target creature. If this spell was kicked with its {2}{R} kicker,
// it deals X damage to that creature's controller. If this spell was kicked
// with its {3}{U} kicker, you draw X cards."
//
// CR 702.33b: "Kicker A and/or B" is two INDEPENDENT kicker costs, so two
// `kickers[]` entries with distinct ids, each read by its own resolution-time
// `if { additionalCostPaid }` (CR 702.33e — the linked clause names only its
// own kicker). The Planeshift Battlemage shape (`pls/black.ts`), on a spell:
// the gate is the resolving stack item's payment record, no permanent needed.
// X is the base cost's announced X (`manaCost.X: "X"`); neither kicker cost
// carries an X of its own, so `{ X: true }` is unambiguous in all three
// clauses. The controller is read via `controllerOf` at resolution, after the
// creature took the damage and before SBAs remove it (CR 704.3), so a lethal
// hit still finds it on the battlefield; a target illegal at resolution
// fizzles the whole spell (CR 608.2b), rider clauses included.
//
// hand-tail: {self} deals X damage to target creature. If this spell was kicked with its {2}{R} kicker, it deals X damage to that creature's controller. If this spell was kicked with its {3}{U} kicker, you draw X cards. (#4500)
export const illuminate: CardDefinition = {
    id: "ceef2761-7301-42de-8f54-49b8cd1e457b", // APC 63
    rarity: "uncommon",
    name: "Illuminate",
    oracleText:
        "Kicker {2}{R} and/or {3}{U} (You may pay an additional {2}{R} and/or {3}{U} as you cast this spell.)\nIlluminate deals X damage to target creature. If this spell was kicked with its {2}{R} kicker, it deals X damage to that creature's controller. If this spell was kicked with its {3}{U} kicker, you draw X cards.",
    manaCost: { X: "X", R: 1 },
    types: ["Sorcery"],
    kickers: [
        {
            id: "kicker-r",
            description: "Kicker {2}{R}",
            mana: { X: 2, R: 1 },
        },
        {
            id: "kicker-u",
            description: "Kicker {3}{U}",
            mana: { X: 3, U: 1 },
        },
    ],
    targetRequirement: { type: "Creature", count: 1 },
    effects: [
        { op: "dealDamage", amount: { X: true }, to: { target: 0 } },
        {
            op: "if",
            predicate: {
                left: { additionalCostPaid: "kicker-r" },
                op: "ge",
                right: 1,
            },
            then: [
                {
                    op: "dealDamage",
                    amount: { X: true },
                    to: { controllerOf: { target: 0 } },
                },
            ],
        },
        {
            op: "if",
            predicate: {
                left: { additionalCostPaid: "kicker-u" },
                op: "ge",
                right: 1,
            },
            then: [
                {
                    op: "draw",
                    player: "controller",
                    count: { X: true },
                },
            ],
        },
    ],
};
