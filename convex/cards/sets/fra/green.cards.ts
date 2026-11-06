// FRA — green cards, split by colour per ADR 0043. The registry's
// `import * as fra from "./sets/fra/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost:
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";
import { enteringEffectivePower } from "../../abilities/triggers/shared";

// Garruk, Curse Breaker — {3}{G}{G} Legendary Planeswalker — Garruk, loyalty 5
// (FRA, issue #8174, Vintage Cube). "Whenever a creature you control with power
// 4 or greater enters, draw a card.
// +2: Untap up to two target lands.
// −3: Create a 4/4 green Beast creature token with trample.
// −4: Until your next turn, whenever one or more creatures attack one of your
// opponents, those creatures get +2/+2 and gain trample until end of turn."
//
// The static trigger is Vaultborn Tyrant's power check (`big/green.cards.ts`):
// EFFECTIVE power through the layer pipeline (CR 613.4), `scope: "yours"`. The
// +2 is Garruk Wildspeaker's untap with "up to two" targets (CR 601.2c). The
// −4 is the "until your next turn" repeating window over the attacking group
// (CR 508.3b, 603.7b): ONE firing per declaration, and the body walks
// `eventAttackers` — only creatures attacking a player, never a planeswalker.
// hand-tail: Until your next turn, whenever one or more creatures attack one of your opponents (#8174)
export const garrukCurseBreaker = defineCard(() => ({
    id: "90ca5812-ceb5-46bd-b049-aed7ff10e6af",
    name: "Garruk, Curse Breaker",
    rarity: "mythic",
    manaCost: { X: 3, G: 2 },
    types: ["Planeswalker"],
    subtypes: ["Garruk"],
    supertypes: ["Legendary"],
    loyalty: 5,
    oracleText:
        "Whenever a creature you control with power 4 or greater enters, draw a card.\n+2: Untap up to two target lands.\n−3: Create a 4/4 green Beast creature token with trample.\n−4: Until your next turn, whenever one or more creatures attack one of your opponents, those creatures get +2/+2 and gain trample until end of turn.",
    triggeredAbilities: [
        enteredTrigger({
            id: "garruk-curse-breaker-big-creature",
            oracleText:
                "Whenever a creature you control with power 4 or greater enters, draw a card.",
            scope: "yours",
            filter: { types: "Creature" },
            // CR 603.2 / 613.4 — the entering creature's EFFECTIVE power.
            condition: (event, _self, state) =>
                (enteringEffectivePower(event, state) ?? 0) >= 4,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        }),
    ],
    activatedAbilities: [
        {
            id: "garruk-curse-breaker-plus2",
            cost: { loyalty: 2 },
            useStack: true,
            oracleText: "+2: Untap up to two target lands.",
            targetRequirement: { type: "Land", count: { min: 0, max: 2 } },
            effects: [
                { op: "tapUntap", action: "untap", target: { target: 0 } },
                { op: "tapUntap", action: "untap", target: { target: 1 } },
            ],
        },
        {
            id: "garruk-curse-breaker-minus3",
            cost: { loyalty: -3 },
            useStack: true,
            oracleText:
                "−3: Create a 4/4 green Beast creature token with trample.",
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Beast",
                        types: ["Creature"],
                        subtypes: ["Beast"],
                        power: 4,
                        toughness: 4,
                        colors: ["G"],
                        staticAbilities: ["trample"],
                    },
                    controller: "controller",
                    count: 1,
                },
            ],
        },
        {
            id: "garruk-curse-breaker-minus4",
            cost: { loyalty: -4 },
            useStack: true,
            oracleText:
                "−4: Until your next turn, whenever one or more creatures attack one of your opponents, those creatures get +2/+2 and gain trample until end of turn.",
            effects: [
                {
                    op: "delayedTrigger",
                    timing: "until-next-turn-creatures-attack-your-opponents",
                    oracleText:
                        "Whenever one or more creatures attack one of your opponents, those creatures get +2/+2 and gain trample until end of turn.",
                    effects: [
                        {
                            op: "forEach",
                            select: { set: "eventAttackers" },
                            effects: [
                                {
                                    op: "pump",
                                    target: { ref: "$each" },
                                    power: 2,
                                    toughness: 2,
                                    duration: { phase: "end-of-turn" },
                                },
                                {
                                    op: "grantAbility",
                                    target: { ref: "$each" },
                                    ability: "trample",
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    ],
}));
