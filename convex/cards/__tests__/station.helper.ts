// Synthetic station cards (CR 702.184 / 721, issue #10528), shared by the GRE
// and client wire tests. No station card ships in the catalogue yet (the Tron
// cards are issues #10552, #10554, #10561), so these are the definitions the
// mechanic's permanent tests run against.

import { registerTokenDefinition } from "..";
import { CHARGE_COUNTER } from "../abilities/station";
import { counterAddedTrigger } from "../abilities/triggers/counterAddedTrigger";

export const SPACECRAFT_ID = "test-station-spacecraft";
export const PLANET_ID = "test-station-planet";
export const BEAR_ID = "test-station-bear-2-2";
export const OX_ID = "test-station-ox-4-4";

/** "Station … It's an artifact creature at 5+. 2+ | {T}: Add {C}. 5+ |
 *  Flying, trample" with a 6/6 box — every striation shape in one card. */
registerTokenDefinition({
    id: SPACECRAFT_ID,
    name: "Test Station Spacecraft",
    rarity: "rare",
    manaCost: { generic: 4 },
    types: ["Artifact"],
    subtypes: ["Spacecraft"],
    stationThresholds: [
        {
            charge: 2,
            activatedAbilities: [
                {
                    id: "test-station-mana",
                    oracleText: "{T}: Add {C}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { C: 1 },
                },
                {
                    id: "test-station-draw",
                    oracleText: "{1}: Draw a card.",
                    cost: { mana: { generic: 1 } },
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
        },
        {
            charge: 5,
            creature: { power: 6, toughness: 6 },
            keywords: ["flying", "trample"],
        },
    ],
});

/** A station card with no P/T box (a Planet): its striation is a static and a
 *  trigger. */
registerTokenDefinition({
    id: PLANET_ID,
    name: "Test Station Planet",
    rarity: "rare",
    manaCost: { generic: 3 },
    types: ["Artifact"],
    subtypes: ["Planet"],
    stationThresholds: [
        {
            charge: 3,
            staticEffects: [
                {
                    kind: "pt-buff",
                    applies: (target, source) =>
                        target.controllerId === source.controllerId &&
                        target.types.includes("Creature"),
                    power: 1,
                    toughness: 1,
                },
            ],
            triggeredAbilities: [
                counterAddedTrigger({
                    id: "test-station-planet-gain",
                    oracleText:
                        "Whenever one or more charge counters are put on this, you gain 1 life.",
                    scope: "self",
                    counterType: CHARGE_COUNTER,
                    effects: [
                        { op: "gainLife", player: "controller", amount: 1 },
                    ],
                }),
            ],
        },
    ],
});

registerTokenDefinition({
    id: BEAR_ID,
    name: "Test Station Bear",
    rarity: "common",
    manaCost: { generic: 2 },
    types: ["Creature"],
    power: 2,
    toughness: 2,
});
registerTokenDefinition({
    id: OX_ID,
    name: "Test Station Ox",
    rarity: "common",
    manaCost: { generic: 4 },
    types: ["Creature"],
    power: 4,
    toughness: 4,
});
