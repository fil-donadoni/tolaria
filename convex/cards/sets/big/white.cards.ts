// BIG — white cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { enteredTrigger } from "../../abilities/triggers/enteredTrigger";

// Rest in Peace — {1}{W} Enchantment. "When this enchantment enters, exile all
// graveyards. / If a card or token would be put into a graveyard from
// anywhere, exile it instead."
//
// Two independent abilities. The ETB is one `moveZone` sweep per seat (CR 603.6a
// — an enters-the-battlefield trigger; the bulk graveyard→exile move is
// filter-only, so an empty filter takes every card). The static line is a
// "graveyard-bound" replacement (CR 614.1a — "instead" marks a replacement
// effect), the same chokepoint Dauthi Voidwalker rides, but unscoped by owner
// so it covers every player's graveyard.
// hand-tail: When this enchantment enters, exile all graveyards. (#8602)
export const restInPeace = defineCard(() => ({
    id: "37c2b1d1-faa0-40fd-82f4-216604ce7635", // RTR 18
    name: "Rest in Peace",
    rarity: "rare",
    oracleText:
        "When this enchantment enters, exile all graveyards.\nIf a card or token would be put into a graveyard from anywhere, exile it instead.",
    manaCost: { X: 1, W: 1 },
    types: ["Enchantment"],
    triggeredAbilities: [
        enteredTrigger({
            id: "rest-in-peace-etb",
            oracleText: "When this enchantment enters, exile all graveyards.",
            scope: "self",
            effects: [
                {
                    op: "moveZone",
                    player: "controller",
                    fromZones: ["graveyard"],
                    filter: {},
                    to: "exile",
                },
                {
                    op: "moveZone",
                    player: "opponent",
                    fromZones: ["graveyard"],
                    filter: {},
                    to: "exile",
                },
            ],
        }),
    ],
    replacementEffects: [
        {
            id: "rest-in-peace-graveyard-exile",
            oracleText:
                "If a card or token would be put into a graveyard from anywhere, exile it instead.",
            eventKind: "graveyard-bound",
            appliesTo: (event) => event.kind === "graveyard-bound",
            replace: (event) => {
                if (event.kind !== "graveyard-bound") {
                    throw new Error("unexpected event kind");
                }
                return {
                    kind: "modified",
                    event: { ...event, destination: "exile" },
                };
            },
        },
    ],
}));
