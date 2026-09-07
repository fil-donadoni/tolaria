// Weatherlight (WTH) — Colorless: artifacts with no coloured mana cost, split by
// colour per ADR 0043. The registry's `import * as wth from "./sets/wth"`
// resolves through wth/index.ts. Modern Scryfall oracle text is authoritative
// (ADR 0004); generic mana is encoded as `X: n` (e.g. {2} → { X: 2 }).
import type { CardDefinition } from "../../types";

// Mind Stone — {2} Artifact. A mana rock that can be cashed in for a card late
// (CR 605.1a mana ability resolves immediately; CR 605 activated draw goes on
// the stack).
export const mindStone: CardDefinition = {
    id: "162e81d3-6cd4-4cb8-8ed8-cfbd8d34ca71",
    name: "Mind Stone",
    rarity: "uncommon",
    oracleText:
        "{T}: Add {C}.\n{1}, {T}, Sacrifice this artifact: Draw a card.",
    manaCost: { X: 2 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "mind-stone-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
        },
        {
            id: "mind-stone-draw",
            oracleText: "{1}, {T}, Sacrifice this artifact: Draw a card.",
            cost: { mana: { X: 1 }, tap: true, sacrifice: true },
            useStack: true,
            // Migrated resolve()→effects[] (ADR 0045, issue #1264).
            effects: [{ op: "draw", player: "controller", count: 1 }],
        },
    ],
};

// Phyrexian Furnace — {1} Artifact, a two-ability graveyard-hate rock:
//  • "{T}: Exile the bottom card of target player's graveyard." The target is
//    the PLAYER (CR 115.1); WHICH card leaves is not a choice at all but the
//    deterministic bottom of that player's ordered graveyard (CR 404.3) — the
//    `moveZone` positional shape (`EffectZonePositionSelector`, the Shallow
//    Grave / Corpse Dance selector) with `position: "bottom"` and its
//    `player` ref pointed at the announced target slot. An empty graveyard is
//    a clean CR 608.2b no-op.
//  • "{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw
//    a card." A real announced target across either bin (CR 603.3d target
//    grammar; `type: "card"` + `zone: "graveyard"` + `controller: "any"` is
//    the Soul-Guide Lantern shape, `thb/colorless.ts`), exiled through
//    `moveZone` and followed by the plain `draw` Op.
//
// compiler-gap: {T}: Exile the bottom card of target player's graveyard. (#2693)
export const phyrexianFurnace: CardDefinition = {
    id: "e98bca31-8c05-430b-b5d7-331bdc55710a",
    name: "Phyrexian Furnace",
    rarity: "uncommon",
    oracleText:
        "{T}: Exile the bottom card of target player's graveyard.\n{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
    manaCost: { X: 1 },
    types: ["Artifact"],
    activatedAbilities: [
        {
            id: "phyrexian-furnace-exile-bottom",
            oracleText:
                "{T}: Exile the bottom card of target player's graveyard.",
            cost: { tap: true },
            useStack: true,
            targetRequirement: { type: "player", count: 1 },
            effects: [
                {
                    op: "moveZone",
                    target: {
                        zone: "graveyard",
                        position: "bottom",
                        player: { target: 0 },
                    },
                    to: "exile",
                },
            ],
        },
        {
            id: "phyrexian-furnace-exile-draw",
            oracleText:
                "{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            targetRequirement: {
                type: "card",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                { op: "draw", player: "controller", count: 1 },
            ],
        },
    ],
};
