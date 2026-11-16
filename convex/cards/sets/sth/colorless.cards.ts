// sth (Stronghold) — colorless cards (ADR 0043 colour split). Modern
// Scryfall oracle text is authoritative (ADR 0004). Lands and colourless
// artifacts (no coloured cost) live here per the colour-split convention.

import { defineCard, type ActivatedAbilityContext } from "../../types";

// Volrath's Stronghold — Legendary Land. "{T}: Add {C}." plus "{1}{B}, {T}:
// Put target creature card from your graveyard on top of your library."
// (CR 605.1a the mana ability — `useStack: false`; CR 602.1 the second,
// ordinary activated ability; CR 601.2c its announced graveyard-card target.)
//
// The recursion leg is the `moveZone` announced-target shape with
// `to: "library-top"` (issue #2713). That destination exists precisely
// because the plain `"library"` zone cannot name an ORDER: the generic
// `moveCardById` library leg pushes, i.e. BOTTOMS the card, which would turn
// a one-card-a-turn engine into a card you never see again. The interpreter
// follows the move with a reorder that brings the card to the top, leaving it a
// public placement, here as one declarative Op.
//
// compiler-gap: {1}{B}, {T}: Put target creature card from your graveyard on top of your library. (#2693)
export const volrathsStronghold = defineCard(() => ({
    id: "43bf015b-152e-4d67-b773-e75fb2487a32", // STH 143
    rarity: "rare",
    name: "Volrath's Stronghold",
    oracleText:
        "{T}: Add {C}.\n{1}{B}, {T}: Put target creature card from your graveyard on top of your library.",
    manaCost: {},
    types: ["Land"],
    supertypes: ["Legendary"],
    activatedAbilities: [
        {
            id: "volraths-stronghold-colorless",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx: ActivatedAbilityContext) => ctx.addMana({ C: 1 }),
            manaProduced: { C: 1 },
        },
        {
            id: "volraths-stronghold-recur",
            oracleText:
                "{1}{B}, {T}: Put target creature card from your graveyard on top of your library.",
            cost: { mana: { X: 1, B: 1 }, tap: true },
            useStack: true,
            targetRequirement: {
                type: "Creature",
                count: 1,
                zone: "graveyard",
                controller: "you",
            },
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "library-top" },
            ],
        },
    ],
}));
