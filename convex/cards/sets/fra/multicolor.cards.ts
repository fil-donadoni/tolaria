// FRA — multicolor cards, split by colour per ADR 0043. The registry's
// `import * as fra from "./sets/fra/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost:
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import type { PermanentView } from "../../types";
import { empowerJaceOps } from "../../abilities/empowerJace";
import { landfallTrigger } from "../../abilities/triggers/landfallTrigger";

// Avatar of Burgeoning Echoes — {G}{U} Creature — Avatar 2/3 (FRA, issue #7225,
// Vintage Cube). "Landfall — Whenever a land you control enters, empower Jace
// 2. / Planeswalkers you control have '[−10]: Put a +1/+1 counter on target
// creature for each land you control.'"
//
// Authored DSL-first (ADR 0045) out of shipped pieces, no new Op:
//   - the landfall half is the shared `landfallTrigger` factory splicing
//     `empowerJaceOps(2)` (CR 701.71a, `abilities/empowerJace.ts`);
//   - the second line is an `activated-grant` static whose template carries
//     `cost.loyalty` (issue #7199): CR 613.1f layer 6 puts a loyalty ability on
//     each planeswalker its controller controls, and CR 606.4 pays the cost on
//     the RECIPIENT. "For each land you control" is a battlefield `count`
//     read at resolution, so "you" is the walker's controller (the granter's
//     controller, which the grant's `applies` pins to).
// hand-tail: Landfall — Whenever a land you control enters, empower Jace N (#7225)
export const avatarOfBurgeoningEchoes = defineCard(() => ({
    id: "5905995b-7a20-4602-a7cc-90aa5089a082",
    name: "Avatar of Burgeoning Echoes",
    rarity: "mythic",
    oracleText:
        'Landfall — Whenever a land you control enters, empower Jace 2. (Put two loyalty counters on a Jace token you control. If you don\'t control one, first create a blue Jace planeswalker token with "[−1]: Surveil 1" and "[−3]: Draw a card.")\nPlaneswalkers you control have "[−10]: Put a +1/+1 counter on target creature for each land you control."',
    manaCost: { G: 1, U: 1 },
    types: ["Creature"],
    subtypes: ["Avatar"],
    power: 2,
    toughness: 3,
    triggeredAbilities: [
        landfallTrigger({
            id: "avatar-of-burgeoning-echoes-landfall",
            oracleText:
                "Landfall — Whenever a land you control enters, empower Jace 2.",
            effects: empowerJaceOps(2),
        }),
    ],
    staticEffects: [
        {
            kind: "activated-grant",
            applies: (target: PermanentView, source: PermanentView) =>
                target.types.includes("Planeswalker") &&
                target.controllerId === source.controllerId,
            abilityId: "avatar-of-burgeoning-echoes-minus10",
        },
    ],
    grantTemplates: [
        {
            id: "avatar-of-burgeoning-echoes-minus10",
            oracleText:
                "[−10]: Put a +1/+1 counter on target creature for each land you control.",
            cost: { loyalty: -10 },
            useStack: true,
            targetRequirement: { type: "Creature", count: 1 },
            effects: [
                {
                    op: "counters",
                    action: "add",
                    target: { target: 0 },
                    counter: "+1/+1",
                    count: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { type: "Land" },
                        },
                    },
                },
            ],
        },
    ],
}));
