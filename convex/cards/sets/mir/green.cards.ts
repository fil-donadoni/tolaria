// mir — green cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import { asEntersColorModes } from "../../abilities/chooseColor";
import { defineCard } from "../../types";

// Quirion Elves — {1}{G} Creature — Elf Druid, 1/1. "As this creature
// enters, choose a color.\n{T}: Add {G}.\n{T}: Add one mana of the chosen
// color." (CR 605.1a two mana abilities on one source; CR 700.2c the colour
// choice.) First printed in Mirage (ADR 0041 home-set rule); reprinted in
// Invasion, whose `CardPrint` lives in `inv/green.cards.ts`, and where issue #1097
// gap 4 was originally surfaced and closed — see that file's comment for the
// full design rationale (`modes` + two `activatedAbilities` + the existing
// `PermanentView.chosenModeId` field). Behaviour tests stay with the INV
// tranche that authored them (`inv/__tests__/green.test.ts`), imported from
// this module.
//
// The colour pick is modelled as an AS-ENTERS choice (CR 614.12a) over
// `CardDefinition.modes` — the SAME idiom Jihad (`arn/white.cards.ts`), Prismatic
// Ward and Chromatic Armor (`ice/white.cards.ts` / `ice/multicolor.cards.ts`) already use
// for "as ~ enters, choose a color". Since #2019 the mode is no longer locked
// at cast announcement: `entersWith.asEnters: [{ kind: "mode" }]` raises it at
// the CR 614 chokepoint as the permanent enters, on every entry path, and the
// answer is written onto the permanent as `chosenModeId`. None of the five
// modes carries a `resolve`/`effects`
// body — exactly like Prismatic Ward's — because the mode's only job is to
// drive the picker and persist the choice; the actual gameplay effect lives
// on the second activated ability below.
//
// The fixed {G} ability and the chosen-colour ability are two SEPARATE
// `activatedAbilities` entries (both `cost.tap`, matching the printed template
// exactly) rather than one two-option `manaChoices` ability —
// `getManaTapOptionsDetailed` (`gre/constants.ts`) already unions every
// non-stack ability's tap options into ONE picker (the dual-land / storage-land
// precedent), so tapping Quirion Elves offers both as a single 2-option choice,
// resolved through the exact same `getEffectiveManaChoices` seam the client's
// picker (`src/lib/card-utils.ts`) and the server's tap mutations already share.
export const quirionElves = defineCard(() => ({
    id: "be9a64fb-1e8d-4ed8-b4c5-3d44db9c1d3b",
    name: "Quirion Elves",
    rarity: "common",
    oracleText:
        "As this creature enters, choose a color.\n{T}: Add {G}.\n{T}: Add one mana of the chosen color.",
    manaCost: { X: 1, G: 1 },
    types: ["Creature"],
    subtypes: ["Elf", "Druid"],
    power: 1,
    toughness: 1,
    // CR 614.1c / 614.12a (issue #2019) — "As this creature enters, choose a
    // color" is a replacement effect, so the pick is declared on
    // `entersWith.asEnters` (ADR 0100 D3) and raised at the single CR 614
    // chokepoint on EVERY entry path, not only a cast. The answer lands on
    // `chosenModeId`, which `manaColorSource` below reads.
    entersWith: { asEnters: [{ kind: "mode" }] },
    modes: asEntersColorModes(),
    activatedAbilities: [
        {
            id: "quirion-elves-green",
            oracleText: "{T}: Add {G}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaProduced: { G: 1 },
        },
        {
            id: "quirion-elves-chosen-color",
            oracleText: "{T}: Add one mana of the chosen color.",
            cost: { tap: true },
            useStack: false,
            // The no-board list (CR 106.7): every colour Quirion Elves could
            // choose, for a caller reading the bare `CardDefinition`.
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            // CR 614.12a / 605.1a — the actual output is the stored colour: a
            // one-entry list, the choice was locked as the creature entered.
            manaColorSource: { colors: "chosen-color" },
        },
    ],
}));
