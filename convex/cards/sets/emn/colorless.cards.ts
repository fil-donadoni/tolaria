// EMN — colorless cards, split by colour per ADR 0043. The registry's
// `import * as emn from "./sets/emn/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { spellCastTrigger } from "../../abilities/triggers/spellCastTrigger";
import { hanweirWrithingTownshipFace } from "./hanweirWrithingTownshipFace.cards";

// Hanweir Battlements — Land (EMN 204). "{T}: Add
// {C}. {R}, {T}: Target creature gains haste until end of turn. {3}{R}{R}, {T}:
// If you both own and control this land and a creature named Hanweir Garrison,
// exile them, then meld them into Hanweir, the Writhing Township."
//
// The half of the meld pair that carries the meld ability (CR 712.4a). "If you
// both own and control" is read on resolution by the `meld` Op, never at
// activation; the Op refuses a token or a non-pair card (CR 701.42b). The melded permanent's attack trigger lives on the
// combined back face (`hanweirWrithingTownshipFace`), where the grammar's
// fragment below is printed.
// hand-tail: Whenever {self} attacks, create two 3/2 colorless Eldrazi Horror creature tokens that are tapped and attacking. (#8600)
export const hanweirBattlements = defineCard(() => ({
    id: "1d743ad6-6ca2-409a-9773-581cc195dbf2", // EMN 204
    rarity: "rare",
    name: "Hanweir Battlements",
    oracleText:
        "{T}: Add {C}.\n{R}, {T}: Target creature gains haste until end of turn.\n{3}{R}{R}, {T}: If you both own and control this land and a creature named Hanweir Garrison, exile them, then meld them into Hanweir, the Writhing Township.\n(Melds with Hanweir Garrison.)",
    types: ["Land"],
    backFace: hanweirWrithingTownshipFace,
    activatedAbilities: [
        {
            id: "hanweir-battlements-mana",
            oracleText: "{T}: Add {C}.",
            cost: { tap: true },
            useStack: false,
            manaProduced: { C: 1 },
            effects: [{ op: "addMana", mana: { C: 1 } }],
        },
        {
            id: "hanweir-battlements-haste",
            oracleText:
                "{R}, {T}: Target creature gains haste until end of turn.",
            cost: { mana: { R: 1 }, tap: true },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "grantAbility",
                    ability: "haste",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
        {
            id: "hanweir-battlements-meld",
            oracleText:
                "{3}{R}{R}, {T}: If you both own and control this land and a creature named Hanweir Garrison, exile them, then meld them into Hanweir, the Writhing Township.",
            cost: { mana: { X: 3, R: 2 }, tap: true },
            useStack: true,
            effects: [
                {
                    op: "meld",
                    partner: { type: "Creature", name: "Hanweir Garrison" },
                },
            ],
        },
    ],
}));

// Emrakul, the Promised End — {13} Legendary Creature — Eldrazi 13/13 (EMN 6).
// "This spell costs {1} less to cast for each card type among cards in your
// graveyard.\nWhen you cast this spell, you gain control of target opponent
// during that player's next turn. After that turn, that player takes an extra
// turn.\nFlying, trample, protection from instants"
//
// The cost clause is a CR 601.2f self-host reduction (the spell is not yet a
// permanent at announcement) counted by the `graveyard-card-types` census:
// distinct card types among the cards in the caster's graveyard (CR 205.2a),
// the same count delirium reads. The cast trigger is CR 603.6e (`scope: "self"`
// goes on the stack above Emrakul, so control and the extra turn are granted
// even if the spell is later countered); its target is chosen as it goes on the
// stack (CR 603.3d). Control is CR 723.1 (`controlNextTurn`), and the extra turn
// is queued behind that turn (`extraTurn` `after: "their-next-turn"`).
// hand-tail: This spell costs {1} less to cast for each card type among cards in your graveyard. (#8616)
export const emrakulThePromisedEnd = defineCard(() => ({
    id: "8d74a469-c71d-4773-99d3-5456b31df424", // EMN 6
    name: "Emrakul, the Promised End",
    rarity: "mythic",
    oracleText:
        "This spell costs {1} less to cast for each card type among cards in your graveyard.\nWhen you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.\nFlying, trample, protection from instants",
    manaCost: { X: 13 },
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Eldrazi"],
    power: 13,
    toughness: 13,
    staticAbilities: ["flying", "trample", "protection from instants"],
    selfCostReduction: {
        costReduction: {
            perCount: { X: 1 },
            countMode: "graveyard-card-types",
        },
    },
    triggeredAbilities: [
        spellCastTrigger({
            id: "emrakul-promised-end-cast-control",
            oracleText:
                "When you cast this spell, you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn.",
            scope: "self",
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                { op: "controlNextTurn", player: { target: 0 } },
                {
                    op: "extraTurn",
                    player: { target: 0 },
                    after: "their-next-turn",
                },
            ],
        }),
    ],
}));
