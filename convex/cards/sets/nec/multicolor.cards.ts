// NEC — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as nec from "./sets/nec/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { makeVehicle } from "../../abilities/vehicle";

// Shorikai, Genesis Engine — {2}{W}{U} Legendary Artifact — Vehicle 8/8 (NEC 4,
// Vintage Cube, issue #1863). Crew 8 through `makeVehicle` (CR 702.122a). The
// `{1}, {T}` ability is an Effect Script on existing Ops: draw two, discard one
// (the loot idiom, Traumatic Critique / LTC's looter), then `createToken` a 1/1
// colorless Pilot whose `crewPowerBonus: 2` is the CR 702.122b rider "This token
// crews Vehicles as though its power were 2 greater" — the token-definition path
// carries it onto the Pilot's synthesized definition, where every crew reader
// already looks. Pilot art is not pinned: the NEC print's own Token Print pairing
// resolves it from `sourcePrintId` (ADR 0140).
// compiler-gap: Crew 8 (#7214)
// hand-tail: {1}, {T}: Draw two cards, then discard a card. Create a 1/1 colorless Pilot creature token with "This token crews Vehicles as though its power were 2 greater." (#1863)
export const shorikaiGenesisEngine = defineCard(() =>
    makeVehicle({
        id: "969ac7dd-f3aa-4888-9ff0-d16a31b5e7a9", // NEC 4
        name: "Shorikai, Genesis Engine",
        rarity: "mythic",
        manaCost: { X: 2, W: 1, U: 1 },
        oracleText:
            '{1}, {T}: Draw two cards, then discard a card. Create a 1/1 colorless Pilot creature token with "This token crews Vehicles as though its power were 2 greater."\nCrew 8 (Tap any number of creatures you control with total power 8 or more: This Vehicle becomes an artifact creature until end of turn.)',
        supertypes: ["Legendary"],
        power: 8,
        toughness: 8,
        crew: 8,
        activatedAbilities: [
            {
                id: "shorikai-genesis-engine-loot-pilot",
                oracleText:
                    '{1}, {T}: Draw two cards, then discard a card. Create a 1/1 colorless Pilot creature token with "This token crews Vehicles as though its power were 2 greater."',
                cost: { mana: { X: 1 }, tap: true },
                useStack: true,
                effects: [
                    { op: "draw", player: "controller", count: 2 },
                    {
                        op: "choice",
                        kind: "choose-hand-card",
                        player: "controller",
                        zone: "hand",
                        count: 1,
                        prompt: "Choose a card to discard.",
                        bind: "$discard",
                    },
                    {
                        op: "discard",
                        player: "controller",
                        cards: { ref: "$discard" },
                    },
                    {
                        op: "createToken",
                        token: {
                            name: "Pilot",
                            types: ["Creature"],
                            subtypes: ["Pilot"],
                            power: 1,
                            toughness: 1,
                            crewPowerBonus: 2,
                        },
                        controller: "controller",
                    },
                ],
            },
        ],
    })
);
