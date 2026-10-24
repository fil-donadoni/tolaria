// Sutured Ghoul's as-enters clause built BY HAND (issue #6528): "As this
// creature enters, exile any number of creature cards from your graveyard."
// Shared by the GRE, full-path and Bot tests of the `exileFromGraveyard`
// as-enters kind; served through `withTemporaryDefinition`, never registered.
//
// Its characteristic-defining P/T ("power equal to the total power of the
// exiled cards …") reads the pile through PR #6514 (issue #5367), not yet on
// base, so it is printed 2/2 here: the CR 704.5f sweep must not bin the
// permanent whose pile a test is reading.
import type { CardDefinition } from "../../../cards/types";

export const GHOUL_ID = "test-6528-sutured-ghoul";

export const suturedGhoul: CardDefinition = {
    id: GHOUL_ID,
    rarity: "rare",
    name: "Sutured Ghoul",
    oracleText:
        "Trample\nAs this creature enters, exile any number of creature cards from your graveyard.",
    manaCost: { generic: 4, B: 3 },
    types: ["Creature"],
    subtypes: ["Zombie"],
    power: 2,
    toughness: 2,
    staticAbilities: ["trample"],
    entersWith: {
        asEnters: [
            { kind: "exileFromGraveyard", filter: { type: "Creature" } },
        ],
    },
};
