// wwk (Worldwake) — colorless cards (ADR 0043 colour split). Modern Scryfall
// oracle text is authoritative (ADR 0004). Lands and colourless artifacts
// (no coloured cost) live here per the colour-split convention.

import type { CardDefinition, SpellContext } from "../../types";

// Creeping Tar Pit — the manland cycle (CR 611.1 animate), same shape as
// Mishra's Factory (`convex/cards/sets/atq/colorless.ts`): `animateAsCreature`
// + `animatesSelf` are not Op-wrapped yet, so the animate ability stays
// `resolve()` — the established precedent for every manland in this catalog,
// not a new escape hatch. "It can't be blocked this turn" composes the
// existing `setCantBeBlockedThisTurn` SpellContext primitive on the source.
// SIMPLIFICATION (flagged): `AnimateSpec` has no `colors` field, so the
// animated creature does not become blue/black while animated (CR 105.1) —
// this only matters against colour-referencing effects (protection, colour
// hosers) while the land is animated, a narrow interaction; P/T, unblockable,
// and "still a land" are all correct. Vintage Cube free tranche
// (issue #675, ADR 0041).
export const creepingTarPit: CardDefinition = {
    id: "0f427f0b-034c-4821-8758-e395c0042d8a",
    rarity: "rare",
    name: "Creeping Tar Pit",
    oracleText:
        "This land enters tapped.\n{T}: Add {U} or {B}.\n{1}{U}{B}: Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It's still a land. It can't be blocked this turn.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "creeping-tar-pit-mana",
            oracleText: "{T}: Add {U} or {B}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ U: 1 }),
            manaChoices: [{ U: 1 }, { B: 1 }],
        },
        {
            id: "creeping-tar-pit-animate",
            oracleText:
                "{1}{U}{B}: Until end of turn, this land becomes a 3/2 blue and black Elemental creature. It's still a land. It can't be blocked this turn.",
            cost: { mana: { X: 1, U: 1, B: 1 } },
            useStack: true,
            animatesSelf: true,
            resolve: (ctx: SpellContext) => {
                const source = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.animateAsCreature(source, {
                    power: 3,
                    toughness: 2,
                    subtype: "Elemental",
                    duration: { phase: "end-of-turn" },
                });
                ctx.setCantBeBlockedThisTurn(source);
            },
        },
    ],
};

// Celestial Colonnade — see Creeping Tar Pit's comment for the manland shape
// and the colour-modelling simplification.
export const celestialColonnade: CardDefinition = {
    id: "f6929259-2903-4f6f-9b06-42048fd55c6a",
    rarity: "rare",
    name: "Celestial Colonnade",
    oracleText:
        "This land enters tapped.\n{T}: Add {W} or {U}.\n{3}{W}{U}: Until end of turn, this land becomes a 4/4 white and blue Elemental creature with flying and vigilance. It's still a land.",
    manaCost: {},
    types: ["Land"],
    entersTapped: true,
    activatedAbilities: [
        {
            id: "celestial-colonnade-mana",
            oracleText: "{T}: Add {W} or {U}.",
            cost: { tap: true },
            useStack: false,
            effect: (ctx) => ctx.addMana({ W: 1 }),
            manaChoices: [{ W: 1 }, { U: 1 }],
        },
        {
            id: "celestial-colonnade-animate",
            oracleText:
                "{3}{W}{U}: Until end of turn, this land becomes a 4/4 white and blue Elemental creature with flying and vigilance. It's still a land.",
            cost: { mana: { X: 3, W: 1, U: 1 } },
            useStack: true,
            animatesSelf: true,
            resolve: (ctx: SpellContext) => {
                const source = {
                    type: "permanent" as const,
                    id: ctx.sourceInstanceId,
                };
                ctx.animateAsCreature(source, {
                    power: 4,
                    toughness: 4,
                    subtype: "Elemental",
                    duration: { phase: "end-of-turn" },
                });
                ctx.grantStaticAbility(source, "flying", {
                    phase: "end-of-turn",
                });
                ctx.grantStaticAbility(source, "vigilance", {
                    phase: "end-of-turn",
                });
            },
        },
    ],
};
