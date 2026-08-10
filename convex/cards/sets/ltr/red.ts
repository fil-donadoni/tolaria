// LTR — red cards, split by colour per ADR 0043. The registry's
// `import * as ltr from "./sets/ltr"` resolves through ltr/index.ts.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import type { CardDefinition } from "../../types";
import { typecyclingAbility } from "../../abilities/cycling";

// Oliphaunt — "Trample. Whenever this creature attacks, another target
// creature you control gets +2/+0 and gains trample until end of turn.
// Mountaincycling {1}." (Issue #1839.) All three clauses declarative:
//  - Trample: CR 702.19, a plain `staticAbilities` keyword.
//  - The attack trigger: the raw `ATTACKERS_DECLARED` + `matches` shape (the
//    established form — Xantid Swarm, Vicious Kavu; there is no
//    attack-trigger factory). "Another target creature you control" is a real
//    CR 603.3d target chosen when the trigger goes on the stack:
//    `controller: "you"` + `excludeSource: true` (the reflexive self-exclude
//    that drops Oliphaunt itself). Body is `pump` + `grantAbility` on
//    `{ target: 0 }`, both `duration: { phase: "end-of-turn" }` (reverted at
//    CLEANUP, CR 514.2).
//  - Mountaincycling {1}: CR 702.29e typecycling — `typecyclingAbility`,
//    which shares plain Cycling's activation shell (CR 702.29f).
export const oliphaunt: CardDefinition = {
    id: "6989018c-37b1-4282-a4af-9cc97f160b4d",
    name: "Oliphaunt",
    rarity: "common",
    manaCost: { X: 5, R: 1 },
    types: ["Creature"],
    subtypes: ["Elephant"],
    power: 6,
    toughness: 4,
    oracleText:
        "Trample\nWhenever this creature attacks, another target creature you control gets +2/+0 and gains trample until end of turn.\nMountaincycling {1} ({1}, Discard this card: Search your library for a Mountain card, reveal it, put it into your hand, then shuffle.)",
    staticAbilities: ["trample"],
    triggeredAbilities: [
        {
            id: "oliphaunt-attack-pump",
            oracleText:
                "Whenever this creature attacks, another target creature you control gets +2/+0 and gains trample until end of turn.",
            event: "ATTACKERS_DECLARED",
            // CR 603.3d — "another target creature you control".
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                excludeSource: true,
            },
            matches: (event, self) =>
                event.type === "ATTACKERS_DECLARED" &&
                event.attackerIds.includes(self.id),
            effects: [
                {
                    op: "pump",
                    target: { target: 0 },
                    power: 2,
                    toughness: 0,
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "grantAbility",
                    ability: "trample",
                    target: { target: 0 },
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
    // CR 702.29e/f — Mountaincycling {1}.
    activatedAbilities: [typecyclingAbility({ generic: 1 }, "Mountain")],
};
