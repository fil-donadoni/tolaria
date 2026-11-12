// EMN — colorless cards, split by colour per ADR 0043. The registry's
// `import * as emn from "./sets/emn/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
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
