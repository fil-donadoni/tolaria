// mir — green cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition, Color, ManaCost } from "../../types";

// Quirion Elves — {1}{G} Creature — Elf Druid, 1/1. "As this creature
// enters, choose a color.\n{T}: Add {G}.\n{T}: Add one mana of the chosen
// color." (CR 605.1a two mana abilities on one source; CR 700.2c the colour
// choice.) First printed in Mirage (ADR 0041 home-set rule); reprinted in
// Invasion, whose `CardPrint` lives in `inv/green.ts`, and where issue #1097
// gap 4 was originally surfaced and closed — see that file's comment for the
// full design rationale (`modes` + two `activatedAbilities` + the existing
// `PermanentView.chosenModeId` field). Behaviour tests stay with the INV
// tranche that authored them (`inv/__tests__/green.test.ts`), imported from
// this module.
//
// The colour pick is modelled as an AS-ENTERS choice (CR 614.12a) over
// `CardDefinition.modes` — the SAME idiom Jihad (`arn/white.ts`), Prismatic
// Ward and Chromatic Armor (`ice/white.ts` / `ice/multicolor.ts`) already use
// for "as ~ enters, choose a color". Since #2019 the mode is no longer locked
// at cast announcement: `entersWith.asEnters: [{ kind: "mode" }]` raises it at
// the CR 614 chokepoint as the permanent enters, on every entry path, and the
// answer is written onto the permanent as `chosenModeId`. None of the five
// modes carries a `resolve`/`effects`
// body — exactly like Prismatic Ward's — because the mode's only job is to
// drive the picker and persist the choice; the actual gameplay effect lives
// on the second activated ability below.
//
// The blocker issue #1097 named was that a MANA ability's `effect` context
// (`ActivatedAbilityContext`) exposes only `addMana`, and `PermanentView`
// (the type the board-conditional `manaAmount`/`getManaChoices` hooks
// receive) had no `chosenModeId` field. That gap has since closed as a side
// effect of other work (`chosenModeId` already sits on `PermanentView`,
// `convex/cards/types.ts` — added for Illusionary Terrain / Jihad-style
// static-effect predicates, not for this issue) — no engine change is needed
// here at all: `getManaChoices` already receives a `source` that carries the
// ETB-stored colour. The fixed {G} ability and the chosen-colour ability are
// two SEPARATE `activatedAbilities` entries (both `cost.tap`, matching the
// printed template exactly) rather than one two-option `manaChoices`
// ability — `getManaTapOptionsDetailed` (`gre/constants.ts`) already unions
// every non-stack ability's tap options into ONE picker (the dual-land /
// storage-land precedent), so tapping Quirion Elves offers both as a single
// 2-option choice, resolved through the exact same `getEffectiveManaChoices`
// seam the client's picker (`src/lib/card-utils.ts`) and the server's tap
// mutations already share.
const QUIRION_ELVES_COLORS: { id: Color; label: string }[] = [
    { id: "W", label: "white" },
    { id: "U", label: "blue" },
    { id: "B", label: "black" },
    { id: "R", label: "red" },
    { id: "G", label: "green" },
];

// Lookup for the SECOND mana ability's actual output (CR 700.2c stored
// colour). A `Record<Color, ...>` must cover the closed `Color` union
// (colourless included) even though Quirion Elves' own modes never offer
// "C" — the "G" entry there is unreachable defensive fallback only, never a
// real game outcome.
const QUIRION_ELVES_COLOR_MANA: Record<Color, ManaCost> = {
    W: { W: 1 },
    U: { U: 1 },
    B: { B: 1 },
    R: { R: 1 },
    G: { G: 1 },
    C: { G: 1 },
};

export const quirionElves: CardDefinition = {
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
    // `chosenModeId`, which `getManaChoices` below reads.
    entersWith: { asEnters: [{ kind: "mode" }] },
    modes: QUIRION_ELVES_COLORS.map(({ id, label }) => ({
        id,
        label,
        oracleText: `Add one mana of ${label}.`,
    })),
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
            // Representative fallback for a best-effort caller with no live
            // instance (CR 106.4 "could produce" deck-analysis queries read
            // this off the bare `CardDefinition`) — every colour Quirion
            // Elves COULD have chosen at ETB, not a default. Real activation
            // always overrides via `getManaChoices` below.
            effect: (ctx) => ctx.addMana({ G: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
            // CR 614.12a / 605.1a — the actual output is the ETB-stored colour
            // (`source.chosenModeId`), read directly off the `PermanentView`
            // every mana-ability hook already receives (issue #1097 added
            // the field). A single-entry list — there is no REAL choice at
            // activation, the choice was already locked as the creature
            // entered the battlefield (CR 614.12a).
            getManaChoices: (source) => [
                QUIRION_ELVES_COLOR_MANA[
                    (source.chosenModeId as Color | undefined) ?? "G"
                ],
            ],
        },
    ],
};
