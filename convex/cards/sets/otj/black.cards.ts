// OTJ — black cards, split by colour per ADR 0043. The registry's
// `import * as otj from "./sets/otj/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { attacksTrigger } from "../../abilities/triggers/attacksTrigger";
import { withSaddle } from "../../abilities/mount";

// Caustic Bronco — {1}{B} Creature — Snake Horse Mount 2/2, Saddle 3.
//
// The attack trigger is Dark Confidant's reveal shape (`rav/black.cards.ts`):
// `digMatchingToHand` reveals the top card to every player (CR 701.20a) and
// puts it into hand, binding it so the life loss reads its mana value
// (CR 202.3). "If this creature isn't saddled" is NOT an intervening-if
// (CR 603.4 — it does not follow the trigger condition), so it is read on
// resolution through `objectMatchesFilter` on `$source` with
// `filter.saddled` (CR 702.171b); a Bronco that left the battlefield in
// response answers with its last known information (CR 608.2h). An empty
// library binds nothing, so neither branch loses any life (CR 609.3).
// hand-tail: Reveal the top card of your library and put it into your hand (#2088)
export const causticBronco = defineCard(() =>
    withSaddle(
        {
            id: "e9a268ba-c442-4fe4-90b4-2810c8474f4e",
            name: "Caustic Bronco",
            rarity: "rare",
            oracleText:
                "Whenever this creature attacks, reveal the top card of your library and put it into your hand. You lose life equal to that card's mana value if this creature isn't saddled. Otherwise, each opponent loses that much life.\nSaddle 3 (Tap any number of other creatures you control with total power 3 or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)",
            manaCost: { X: 1, B: 1 },
            types: ["Creature"],
            subtypes: ["Snake", "Horse", "Mount"],
            power: 2,
            toughness: 2,
            triggeredAbilities: [
                attacksTrigger({
                    id: "caustic-bronco-attacks",
                    oracleText:
                        "Whenever this creature attacks, reveal the top card of your library and put it into your hand. You lose life equal to that card's mana value if this creature isn't saddled. Otherwise, each opponent loses that much life.",
                    scope: "self",
                    effects: [
                        {
                            op: "digMatchingToHand",
                            player: "controller",
                            look: 1,
                            // Match-all: the single revealed card always goes
                            // to hand; nothing is left for `destination`.
                            filter: {},
                            destination: "graveyard",
                            bind: "$revealed",
                        },
                        {
                            op: "if",
                            predicate: {
                                objectMatchesFilter: { ref: "$source" },
                                filter: { saddled: true },
                            },
                            then: [
                                {
                                    op: "loseLife",
                                    player: "opponent",
                                    amount: {
                                        manaValue: { of: { ref: "$revealed" } },
                                    },
                                },
                            ],
                            else: [
                                {
                                    op: "loseLife",
                                    player: "controller",
                                    amount: {
                                        manaValue: { of: { ref: "$revealed" } },
                                    },
                                },
                            ],
                        },
                    ],
                }),
            ],
        },
        3
    )
);
