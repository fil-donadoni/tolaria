// mh2 (Modern Horizons 2) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import { AURA_AFFECTS_HOST } from "../../types";
import type { CardDefinition } from "../../types";
import { equipAbility, livingWeapon } from "../../abilities/equipment";
import { damageDealtTrigger } from "../../abilities/triggers/damageDealtTrigger";

// Yavimaya, Cradle of Growth — "Each land is a Forest in addition to its
// other land types." (CR 305.7, 611 — layer 4 subtype addition.) Same
// `subtype-add` shape as Urborg, Tomb of Yawgmoth
// (`convex/cards/sets/plc/colorless.ts`) — see that card's comment for the
// full rationale. No explicit `activatedAbilities` needed: Yavimaya's own
// effect adds "Forest" to its own live `subtypes`, and the engine's
// basic-land-type mana inference grants the {T}: Add {G} ability for free.
export const yavimayaCradleOfGrowth: CardDefinition = {
    id: "4e4b6e22-93b2-4896-bba5-0ceaa5d8ea3c",
    rarity: "rare",
    name: "Yavimaya, Cradle of Growth",
    oracleText: "Each land is a Forest in addition to its other land types.",
    manaCost: {},
    supertypes: ["Legendary"],
    types: ["Land"],
    staticEffects: [
        {
            kind: "subtype-add",
            applies: (target) => target.types.includes("Land"),
            subtypes: ["Forest"],
        },
    ],
};

// Kaldra Compleat (issue #1340, parent PRD #620; closes the #679 Living
// Weapon stub) — Living weapon on the biggest possible statline.
//
//  - Living weapon (CR 702.92a) — the shared `livingWeapon()` self-ETB
//    trigger (createToken Germ + `attach`, ADR 0065). The Germ arrives as a
//    0/0 and is immediately a 5/5 indestructible first-striker, which is the
//    whole point of the card.
//  - "Indestructible" on the line by itself is the EQUIPMENT's own printed
//    keyword (CR 702.12), not a grant — hence `staticAbilities`, separate
//    from the `keyword-grant` that hands indestructible to the host.
//  - The quoted ability inside the grant clause is a granted TRIGGERED
//    ability (CR 702.6d / 611): it lives on `triggeredGrantTemplates[]` and
//    is pushed onto the host by a `triggered-grant` static, the Lavaspur
//    Boots / Energy Flux convention. Kept OFF `triggeredAbilities` so Kaldra
//    Compleat itself (never a creature, never a combat-damage source) can't
//    fire its own copy. Inside the template `self` is the RECIPIENT — the
//    equipped creature — so `source: "self"` in the factory means "the
//    equipped creature dealt the damage", and `$event.damagedPermanent`
//    (ADR 0049) names the creature it damaged. Same shape as Voracious
//    Cobra's destroy trigger (`inv/multicolor.ts`), with `exile` instead.
export const kaldraCompleat: CardDefinition = {
    id: "87cc2855-6b14-44dd-a398-7dc2bbae081f",
    name: "Kaldra Compleat",
    rarity: "mythic",
    oracleText:
        'Living weapon\nIndestructible\nEquipped creature gets +5/+5 and has first strike, trample, indestructible, haste, and "Whenever this creature deals combat damage to a creature, exile that creature."\nEquip {7}',
    manaCost: { generic: 7 },
    types: ["Artifact"],
    supertypes: ["Legendary"],
    subtypes: ["Equipment"],
    staticAbilities: ["indestructible"],
    staticEffects: [
        {
            kind: "pt-buff",
            applies: AURA_AFFECTS_HOST,
            power: 5,
            toughness: 5,
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "first strike",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "trample",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "indestructible",
        },
        {
            kind: "keyword-grant",
            applies: AURA_AFFECTS_HOST,
            keyword: "haste",
        },
        {
            kind: "triggered-grant",
            applies: AURA_AFFECTS_HOST,
            abilityId: "kaldra-compleat-granted-exile",
        },
    ],
    triggeredGrantTemplates: [
        damageDealtTrigger({
            id: "kaldra-compleat-granted-exile",
            oracleText:
                "Whenever this creature deals combat damage to a creature, exile that creature.",
            // `self` here is the permanent CARRYING the granted ability (the
            // equipped creature) — the damage source the Oracle text means.
            source: "self",
            // CR 510 — combat damage only, and only damage dealt to a
            // creature (a planeswalker/battle/player hit does not qualify).
            isCombat: true,
            target: { kind: "permanent", filter: { types: "Creature" } },
            effects: [
                { op: "exile", target: { ref: "$event.damagedPermanent" } },
            ],
        }),
    ],
    triggeredAbilities: [livingWeapon({ id: "kaldra-compleat-living-weapon" })],
    activatedAbilities: [
        equipAbility({
            id: "kaldra-compleat-equip",
            cost: { generic: 7 },
            oracleText: "Equip {7}",
        }),
    ],
};

// Nettlecyst (issue #1340, parent PRD #620) — Living weapon with a
// board-scaling buff. The buff is a characteristic-defining `pt-cda`
// (CR 604.3) rather than a flat `pt-buff`: "+1/+1 for each artifact and/or
// enchantment YOU control" is re-read at stat-read time, and "you" is the
// EQUIPMENT's controller (CR 109.5), not the equipped creature's — the two
// differ once a control-change effect steals the host (the Equipment stays
// attached, CR 301.5c). Nettlecyst counts ITSELF (it is an artifact you
// control), so a lone Nettlecyst on an otherwise empty board makes its Germ
// a 1/1 — CR 604.3's "each" is a live board count with no self-exclusion.
export const nettlecyst: CardDefinition = {
    id: "4a0bb5dc-75a6-4bd6-81f8-611197fb0fba",
    name: "Nettlecyst",
    rarity: "rare",
    oracleText:
        "Living weapon (When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.)\nEquipped creature gets +1/+1 for each artifact and/or enchantment you control.\nEquip {2}",
    manaCost: { generic: 3 },
    types: ["Artifact"],
    subtypes: ["Equipment"],
    staticEffects: [
        {
            kind: "pt-cda",
            applies: AURA_AFFECTS_HOST,
            compute: (source, state) => {
                const n = state.players
                    .flatMap((pl) => pl.battlefield)
                    .filter(
                        (c) =>
                            c.controllerId === source.controllerId &&
                            (c.types.includes("Artifact") ||
                                c.types.includes("Enchantment"))
                    ).length;
                return { power: n, toughness: n };
            },
        },
    ],
    triggeredAbilities: [livingWeapon({ id: "nettlecyst-living-weapon" })],
    activatedAbilities: [
        equipAbility({
            id: "nettlecyst-equip",
            cost: { generic: 2 },
            oracleText: "Equip {2}",
        }),
    ],
};
