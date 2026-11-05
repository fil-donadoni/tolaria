// An as-enters copy of a graveyard card, built BY HAND (issue #8041): the
// clause Superior Spider-Man prints, on a probe card, so the engine seam is
// tested before the card ships (issue #7251). Served through
// `withTemporaryDefinition`, never registered.
import type { CardDefinition } from "../../../cards/types";

export const PROBE_ID = "test-8041-graveyard-copy";
export const PROBE_NAME = "Graveyard Copy Probe";

export const graveyardCopyProbe: CardDefinition = {
    id: PROBE_ID,
    rarity: "mythic",
    name: PROBE_NAME,
    oracleText:
        "You may have this creature enter as a copy of any creature card in a graveyard, except its name is Graveyard Copy Probe and it's a 4/4 Spider Human Hero in addition to its other types. When you do, exile that card.",
    manaCost: { generic: 2, U: 1, B: 1 },
    types: ["Creature"],
    subtypes: ["Spider", "Human", "Hero"],
    power: 4,
    toughness: 4,
    entersWith: {
        asEnters: [
            {
                kind: "copy",
                fromGraveyard: { type: "Creature" },
                opts: {
                    name: PROBE_NAME,
                    basePower: 4,
                    baseToughness: 4,
                    additionalSubtypes: ["Spider", "Human", "Hero"],
                },
                whenCopied: {
                    oracleText: "When you do, exile that card.",
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$copied" },
                            from: "graveyard",
                            to: "exile",
                        },
                    ],
                },
            },
        ],
    },
};

/** A legendary creature, for the CR 704.5j name-keyed legend rule. */
export const LEGEND_ID = "test-8041-legend";
export const legend: CardDefinition = {
    id: LEGEND_ID,
    rarity: "rare",
    name: "Probe Legend",
    oracleText: "",
    manaCost: { generic: 2 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Human"],
    power: 2,
    toughness: 2,
};
