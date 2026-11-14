// AVR — colorless cards, split by colour per ADR 0043. The registry's
// `import * as avr from "./sets/avr/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../types";
import { CREATURE_SUBTYPES } from "../../../oracle/grammar/shared/subtypes";

// Cavern of Souls — Land (AVR, the earliest paper printing, ADR 0041).
// "As this land enters, choose a creature type." is the CR 614.1c / 614.12a
// as-enters choice (`entersWith.asEnters: { kind: "subtypes" }`, from CR
// 205.3m's creature-type table), stored on `CardInstanceState.chosenSubtypes`
// (Brass Herald's shape). The second mana ability is Delighted Halfling's
// declarative shape (CR 605.3a, `useStack: false`) with the restriction keyed
// on that choice: `chosen-type-creature-spell` (CR 106.6, issue #9388) admits
// only a creature spell of the chosen type, snapshots the choice onto the
// mana, and `manaCantBeCounteredRider` makes the spell uncounterable.
// hand-tail: {T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered. (#8609)
export const cavernOfSouls = defineCard(() => ({
    id: "1381c8f1-a292-4bdf-b20c-a5c2a169ee84",
    name: "Cavern of Souls",
    rarity: "rare",
    oracleText:
        "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
    manaCost: {},
    types: ["Land"],
    subtypes: [],
    entersWith: {
        asEnters: [
            { kind: "subtypes", from: [...CREATURE_SUBTYPES], count: 1 },
        ],
    },
    activatedAbilities: [
        {
            id: "cavern-of-souls-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
            effect: (ctx) => ctx.addMana({ C: 1 }),
        },
        {
            id: "cavern-of-souls-chosen-type",
            oracleText:
                "{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
            cost: { tap: true },
            useStack: false,
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            manaRestriction: "chosen-type-creature-spell",
            manaCantBeCounteredRider: true,
            // Representative fallback (Adarkar Unicorn pattern) — the real
            // choice always resolves through `manaChoices` above.
            manaProduced: { G: 1 },
            effect: (ctx) => ctx.addMana({ G: 1 }),
        },
    ],
}));
