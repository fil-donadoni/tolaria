// HOB — green cards, split by colour per ADR 0043. The registry's
// `import * as hob from "./sets/hob/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.
import { defineCard } from "../../../../convex/cards/types";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Mole Man, Moloid Master — {2}{G} Legendary Creature — Human Villain, 1/1
// (Vintage Cube, issue #7240). "You may play lands from your graveyard.
// Landfall — Whenever a land you control enters, create a 1/1 green Minion
// creature token named Moloid with "Whenever this token attacks, you may mill
// a card.""
//   - `graveyardPlayPermission: { actions: ["play-land"] }` — the one
//     graveyard play permission record (ADR 0093), same row as Icetill
//     Explorer.
//   - Landfall→token: the shared `landfallTrigger` (CR 603.6a / 109.2) with a
//     DSL `createToken` Op; the token carries its OWN attack trigger through
//     `EffectTokenSpec.triggeredAbilities` (`ATTACKERS_DECLARED`, self-scoped
//     per CR 109.2, CR 508.1m). Its "you may mill" is a cost-free `mayPay`
//     (issue #680) gating a `mill` Op (CR 701.17a).
// compiler-gap: Landfall — Whenever a land you control enters, create a N/N green Minion creature token named Moloid with "Whenever this token attacks, you may mill a card." (#7220)
export const moleManMoloidMaster = defineCard(() => ({
    id: "1b406cc5-75c9-430a-83a2-de0f2a8aeae6",
    name: "Mole Man, Moloid Master",
    rarity: "rare",
    oracleText:
        'You may play lands from your graveyard.\nLandfall — Whenever a land you control enters, create a 1/1 green Minion creature token named Moloid with "Whenever this token attacks, you may mill a card."',
    manaCost: { X: 2, G: 1 },
    supertypes: ["Legendary"],
    types: ["Creature"],
    subtypes: ["Human", "Villain"],
    power: 1,
    toughness: 1,
    graveyardPlayPermission: { actions: ["play-land"] },
    triggeredAbilities: [
        landfallTrigger({
            id: "mole-man-moloid-master-landfall",
            oracleText:
                'Landfall — Whenever a land you control enters, create a 1/1 green Minion creature token named Moloid with "Whenever this token attacks, you may mill a card."',
            effects: [
                {
                    op: "createToken",
                    controller: "controller",
                    token: {
                        name: "Moloid",
                        types: ["Creature"],
                        subtypes: ["Minion"],
                        power: 1,
                        toughness: 1,
                        colors: ["G"],
                        triggeredAbilities: [
                            {
                                id: "moloid-attacks-may-mill",
                                oracleText:
                                    "Whenever this token attacks, you may mill a card.",
                                event: "ATTACKERS_DECLARED",
                                effects: [
                                    {
                                        op: "mayPay",
                                        player: "controller",
                                        prompt: "Mill a card?",
                                        bind: "$mill",
                                    },
                                    {
                                        op: "if",
                                        predicate: { binding: "$mill" },
                                        then: [
                                            {
                                                op: "mill",
                                                player: "controller",
                                                count: 1,
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                },
            ],
        }),
    ],
}));
