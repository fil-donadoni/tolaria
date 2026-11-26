// one — colorless cards (ADR 0043 colour split).
import { defineCard, PERMANENT_TYPES } from "../../types";

// Soulless Jailer — {2} Artifact Creature — Phyrexian Golem 0/4 (issue
// #10558, modern Tron). Two read-time clauses, both declared on the permanent
// and scanned live, so each lifts the instant the Jailer leaves the
// battlefield (the Grafdigger's Cage pair, widened):
// - "Permanent cards in graveyards can't enter the battlefield." is
//   `blocksBattlefieldEntryFrom` over the graveyard and every permanent type
//   (CR 110.4a "permanent card"; CR 614.17 a "can't" effect, not a
//   replacement), consulted at the shared non-cast entry chokepoint; the card
//   stays in its zone.
// - "Players can't cast noncreature spells from graveyards or exile." is a
//   `cast-restriction` static (CR 601.3) keyed on the cast subject's zone
//   and its announced characteristics (CR 601.3e), so an Adventure half cast
//   from exile is refused while the creature face stays castable.
// hand-tail: Permanent cards in graveyards can't enter the battlefield. (#10558)
export const soullessJailer = defineCard(() => ({
    id: "bf9991fd-ea6a-4ed7-b5f1-46a95f8d0634",
    name: "Soulless Jailer",
    rarity: "rare",
    oracleText:
        "Permanent cards in graveyards can't enter the battlefield.\nPlayers can't cast noncreature spells from graveyards or exile.",
    manaCost: { generic: 2 },
    types: ["Artifact", "Creature"],
    subtypes: ["Phyrexian", "Golem"],
    power: 0,
    toughness: 4,
    blocksBattlefieldEntryFrom: {
        zones: ["graveyard"],
        types: [...PERMANENT_TYPES],
    },
    staticEffects: [
        {
            kind: "cast-restriction",
            id: "soulless-jailer-no-noncreature-cast-from-graveyard-or-exile",
            forbids: (_caster, spell) =>
                (spell.zone === "graveyard" || spell.zone === "exile") &&
                !spell.types.includes("Creature"),
            oracleText:
                "Players can't cast noncreature spells from graveyards or exile.",
        },
    ],
}));
