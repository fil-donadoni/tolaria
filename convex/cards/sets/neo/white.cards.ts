// NEO — white cards, split by colour per ADR 0043. The registry's
// `import * as neo from "./sets/neo/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import {
    defineCard,
    AURA_AFFECTS_HOST,
    RECONFIGURE_LOSES_CREATURE_WHILE_ATTACHED,
} from "../../types";
import { reconfigureAbilities } from "../../abilities/equipment";

// Lion Sash — "{W}: Exile target card from a graveyard. If it was a
// permanent card, put a +1/+1 counter on this permanent. Equipped creature
// gets +1/+1 for each +1/+1 counter on this Equipment. Reconfigure {2}"
// (CR 702.151, issue #1311 — unblocks #917's Vintage Cube tranche). Ships
// the Reconfigure keyword end-to-end via ADR 0065's unified attachment
// model: the two Reconfigure activated abilities are the generic `attach` /
// `unattach` Effect Script Ops (CR 701.3), and "isn't a creature while
// attached" (CR 702.151b) is the `type-remove` static effect gated by the
// shared `RECONFIGURE_LOSES_CREATURE_WHILE_ATTACHED` predicate.
//
// "Equipped creature gets +1/+1 for each +1/+1 counter on this Equipment" is
// a P/T modification (CR 613.4c, `pt-buff` `computeFor`) reading counters
// on the SOURCE (Lion Sash) and applying to its HOST via the canonical
// `AURA_AFFECTS_HOST` predicate — the same attach plumbing an Aura's P/T buff
// uses, generalized: `AURA_AFFECTS_HOST` only reads `source.attachedTo`, it
// doesn't care whether the source is an Aura or an Equipment.
// hand-tail: Equipped creature gets +1/+1 for each +1/+1 counter on this Equipment. (#8505)
export const lionSash = defineCard(() => ({
    id: "3e1766e9-2fa7-4446-a255-7beea1467ece",
    name: "Lion Sash",
    rarity: "rare",
    oracleText:
        "{W}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on this permanent.\nEquipped creature gets +1/+1 for each +1/+1 counter on this Equipment.\nReconfigure {2} ({2}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature.)",
    manaCost: { generic: 1, W: 1 },
    types: ["Artifact", "Creature"],
    subtypes: ["Equipment", "Cat"],
    power: 1,
    toughness: 1,
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            computeFor: (source) => {
                const n = source.counters?.["+1/+1"] ?? 0;
                return { power: n, toughness: n };
            },
        },
        {
            kind: "type-remove",
            applies: RECONFIGURE_LOSES_CREATURE_WHILE_ATTACHED,
            types: ["Creature"],
        },
    ],
    activatedAbilities: [
        {
            id: "lion-sash-graveyard-hate",
            oracleText:
                "{W}: Exile target card from a graveyard. If it was a permanent card, put a +1/+1 counter on this permanent.",
            cost: { mana: { W: 1 } },
            targetRequirement: { type: "card", count: 1, zone: "graveyard" },
            useStack: true,
            effects: [
                {
                    op: "moveZone",
                    target: { target: 0 },
                    to: "exile",
                    bind: "$exiled",
                },
                {
                    op: "if",
                    predicate: {
                        left: { ref: "$exiled.isPermanentCard" },
                        op: "eq",
                        right: 1,
                    },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "+1/+1",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
        ...reconfigureAbilities({
            slug: "lion-sash",
            cost: { generic: 2 },
            costText: "{2}",
            oracleText: "Reconfigure {2}",
        }),
    ],
}));

// The Wandering Emperor (issue #2606) — {2}{W}{W} Legendary Planeswalker,
// loyalty 3.
//   Flash — the implemented keyword (CR 702.8a).
//   "As long as The Wandering Emperor entered this turn, you may activate her
//   loyalty abilities any time you could cast an instant." — the
//   `loyalty-activation-timing` static, conditioned on `entered-this-turn`:
//   CR 606.3's sorcery-speed window widens to CR 117.1a's "any time they have
//   priority" while her `enteredOnTurn` stamp is the current turn, and lapses
//   on the next. CR 606.3's once-per-turn allowance is untouched.
//   +1 — "up to one target creature" is min 0 (CR 601.2c, a variable number of targets): the counter and the
//   CR 611.2a first-strike grant land on the same target, or on nothing.
//   −1 — a 2/2 white Samurai token with vigilance (NEO token print, resolved
//   off the creator's print, ADR 0140).
//   −2 — "target tapped creature" (any controller's), then 2 life.
// compiler-gap: "As long as {self} entered this turn, you may activate her loyalty abilities any time you could cast an instant" (#8493)
export const theWanderingEmperor = defineCard(() => ({
    id: "fab2d8a9-ab4c-4225-a570-22636293c17d",
    name: "The Wandering Emperor",
    rarity: "mythic",
    oracleText:
        "Flash\nAs long as The Wandering Emperor entered this turn, you may activate her loyalty abilities any time you could cast an instant.\n+1: Put a +1/+1 counter on up to one target creature. It gains first strike until end of turn.\n−1: Create a 2/2 white Samurai creature token with vigilance.\n−2: Exile target tapped creature. You gain 2 life.",
    manaCost: { X: 2, W: 2 },
    types: ["Planeswalker"],
    supertypes: ["Legendary"],
    loyalty: 3,
    staticAbilities: ["flash"],
    staticEffects: [
        { kind: "loyalty-activation-timing", condition: "entered-this-turn" },
    ],
    activatedAbilities: [
        {
            id: "the-wandering-emperor-plus1",
            cost: { loyalty: 1 },
            useStack: true,
            oracleText:
                "+1: Put a +1/+1 counter on up to one target creature. It gains first strike until end of turn.",
            targetRequirement: { type: "Creature", count: { min: 0, max: 1 } },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 1,
                },
                {
                    op: "grantAbility",
                    ability: "first strike",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "the-wandering-emperor-minus1",
            cost: { loyalty: -1 },
            useStack: true,
            oracleText:
                "−1: Create a 2/2 white Samurai creature token with vigilance.",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Samurai",
                        types: ["Creature"],
                        subtypes: ["Samurai"],
                        power: 2,
                        toughness: 2,
                        colors: ["W"],
                        staticAbilities: ["vigilance"],
                    },
                    controller: "controller",
                },
            ],
        },
        {
            id: "the-wandering-emperor-minus2",
            cost: { loyalty: -2 },
            useStack: true,
            oracleText: "−2: Exile target tapped creature. You gain 2 life.",
            targetRequirement: {
                type: "Creature",
                count: 1,
                tappedFilter: "tapped",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                { op: "gainLife", player: "controller", amount: 2 },
            ],
        },
    ],
}));
