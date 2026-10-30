// FRA — black cards, split by colour per ADR 0043. The registry's
// `import * as fra from "./sets/fra/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost:
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import type { PermanentView } from "../../types";
import { empowerJaceOps } from "../../abilities/empowerJace";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

const planeswalkerYouControl = (
    target: PermanentView,
    source: PermanentView
): boolean =>
    target.types.includes("Planeswalker") &&
    target.controllerId === source.controllerId;

// Sanctum Lurker — {2}{B} Creature — Horror 3/2 (FRA, issue #7247, Vintage
// Cube). "When this creature enters, empower Jace 1. / Planeswalkers you
// control aren't put into their owners' graveyards for having 0 loyalty. /
// Planeswalkers you control have '[+2]: This planeswalker deals 1 damage to
// each opponent and you gain 1 life.'"
//
// Authored DSL-first (ADR 0045) out of shipped pieces, no new Op:
//   - the ETB is `enteredTrigger` (CR 603.6a) splicing `empowerJaceOps(1)`
//     (CR 701.71a, `abilities/empowerJace.ts`);
//   - the zero-loyalty line is a `permanent-guard` with `survivesZeroLoyalty`
//     (CR 704.5i exemption, issue #7199, gated in `sba.ts`);
//   - the third line is an `activated-grant` whose template carries
//     `cost.loyalty` (CR 613.1f layer 6; CR 606.4 pays the cost on the
//     RECIPIENT). "Each opponent" is `{ player: "opponent" }`, "you" the
//     walker's controller.
// hand-tail: Planeswalkers you control aren't put into their owners' graveyards for having 0 loyalty (#7247)
export const sanctumLurker = defineCard(() => ({
    id: "2185c08f-bb4d-49d5-8b6c-c629a48bb61c",
    name: "Sanctum Lurker",
    rarity: "rare",
    oracleText:
        'When this creature enters, empower Jace 1. (If you don\'t control a Jace planeswalker token, first create a blue Jace planeswalker token with "[−1]: Surveil 1" and "[−3]: Draw a card." Then put a loyalty counter on it.)\nPlaneswalkers you control aren\'t put into their owners\' graveyards for having 0 loyalty.\nPlaneswalkers you control have "[+2]: This planeswalker deals 1 damage to each opponent and you gain 1 life."',
    manaCost: { X: 2, B: 1 },
    types: ["Creature"],
    subtypes: ["Horror"],
    power: 3,
    toughness: 2,
    triggeredAbilities: [
        enteredTrigger({
            id: "sanctum-lurker-etb-empower",
            oracleText: "When this creature enters, empower Jace 1.",
            scope: "self",
            effects: empowerJaceOps(1),
        }),
    ],
    staticEffects: [
        {
            kind: "permanent-guard",
            id: "sanctum-lurker-zero-loyalty",
            applies: planeswalkerYouControl,
            survivesZeroLoyalty: true,
        },
        {
            kind: "activated-grant",
            applies: planeswalkerYouControl,
            abilityId: "sanctum-lurker-plus2",
        },
    ],
    grantTemplates: [
        {
            id: "sanctum-lurker-plus2",
            oracleText:
                "[+2]: This planeswalker deals 1 damage to each opponent and you gain 1 life.",
            cost: { loyalty: 2 },
            useStack: true,
            effects: [
                { op: "dealDamage", amount: 1, to: { player: "opponent" } },
                { op: "gainLife", player: "controller", amount: 1 },
            ],
        },
    ],
}));
