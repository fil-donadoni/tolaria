// lrw — multicolor cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004); canonical
// name/cost/types are from Scryfall (id = first paper printing, LRW).

import { manaValue } from "../../../gre/constants";
import { getInstanceManaCost } from "../../registry";
import { defineCard } from "../../types";

// Gaddock Teeg — {G}{W} Legendary Creature — Kithkin Advisor 2/2. Each Oracle
// line is a player-agnostic `cast-restriction` static (CR 601.3: no player may
// begin to cast a spell an effect prohibits), scanned live at the shared cast
// gate, so both lift the moment Teeg leaves the battlefield.
// - The mana value is read off the card as cast (CR 202.3e: X counts 0 off the
//   stack) through `manaValue`, which values hybrid and Phyrexian pips
//   (CR 202.3f, 202.3g).
// - "Noncreature" reads the announced characteristics (CR 601.3e), so an
//   Adventure or split half is judged as the half being cast.
// - An X spell whose MV could drop under 4 still falls to the second line
//   (CR 601.3a lets X = 0 dodge the first line only).
// hand-tail: Noncreature spells with mana value 4 or greater can't be cast. (#10547)
export const gaddockTeeg = defineCard(() => ({
    id: "32c16e1b-f4ce-409f-928a-42c666adac9d",
    name: "Gaddock Teeg",
    rarity: "rare",
    oracleText:
        "Noncreature spells with mana value 4 or greater can't be cast.\nNoncreature spells with {X} in their mana costs can't be cast.",
    manaCost: { G: 1, W: 1 },
    types: ["Creature"],
    subtypes: ["Kithkin", "Advisor"],
    supertypes: ["Legendary"],
    power: 2,
    toughness: 2,
    staticEffects: [
        {
            kind: "cast-restriction",
            id: "gaddock-teeg-no-noncreature-mv-4-or-greater",
            forbids: (_caster, spell) =>
                !spell.types.includes("Creature") &&
                manaValue(getInstanceManaCost(spell)) >= 4,
            oracleText:
                "Noncreature spells with mana value 4 or greater can't be cast.",
        },
        {
            kind: "cast-restriction",
            id: "gaddock-teeg-no-noncreature-x-spells",
            forbids: (_caster, spell) =>
                !spell.types.includes("Creature") &&
                getInstanceManaCost(spell)?.X === "X",
            oracleText:
                "Noncreature spells with {X} in their mana costs can't be cast.",
        },
    ],
}));
