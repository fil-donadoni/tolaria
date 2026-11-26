// BIG — colorless cards, split by colour per ADR 0043. The registry's
// `import * as big from "./sets/big/index.cards"` re-exports this module.
// Cards are classified by the colour identity of their mana cost (CR 202.2):
// lands and colourless artifacts (no coloured cost) live in colorless.ts.

import { defineCard } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Nexus of Becoming — {6} Artifact. One beginning-of-combat trigger on its
// controller's turn, four Ops in Oracle order:
//   - `draw` one card FIRST, so the card just drawn is eligible for the pick.
//   - "you may exile an artifact or creature card from your hand" is a
//     0-or-1 `choose-hand-card` pick (the Sneak Attack idiom) moved to exile
//     by `moveZone`, whose `bind` snapshots the card in exile (issue #10557).
//   - "If you do, create a token that's a copy of the exiled card" reads that
//     snapshot: nothing picked, or a replacement that kept the card out of
//     exile, leaves `$exiled` uncaptured and the copy skips. The copy reads
//     the card's current values in exile, the zone the effect expects it in
//     (CR 608.2h).
//   - "except it's a 3/3 Golem artifact creature in addition to its other
//     types" is the `except` clause, part of the copiable values (CR 707.9b):
//     base 3/3, Artifact + Creature types and the Golem subtype added (an
//     artifact card already Artifact is deduplicated by `applyCopy`).
// hand-tail: At the beginning of combat on your turn, draw a card. Then you may exile an artifact or creature card from your hand. If you do, create a token that's a copy of the exiled card, except it's a 3/3 Golem artifact creature in addition to its other types. (#10557)
export const nexusOfBecoming = defineCard(() => ({
    id: "b0f61742-522c-4b36-97db-41d0c412a072",
    name: "Nexus of Becoming",
    rarity: "mythic",
    oracleText:
        "At the beginning of combat on your turn, draw a card. Then you may exile an artifact or creature card from your hand. If you do, create a token that's a copy of the exiled card, except it's a 3/3 Golem artifact creature in addition to its other types.",
    manaCost: { X: 6 },
    types: ["Artifact"],
    triggeredAbilities: [
        phaseTrigger({
            id: "nexus-of-becoming-combat",
            oracleText:
                "At the beginning of combat on your turn, draw a card. Then you may exile an artifact or creature card from your hand. If you do, create a token that's a copy of the exiled card, except it's a 3/3 Golem artifact creature in addition to its other types.",
            phase: "BEGINNING_OF_COMBAT",
            scope: "your",
            effects: [
                { op: "draw", player: "controller", count: 1 },
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: "controller",
                    zone: "hand",
                    filter: { type: ["Artifact", "Creature"] },
                    count: { min: 0, max: 1 },
                    prompt: "Exile an artifact or creature card from your hand (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: "controller",
                    from: "hand",
                    to: "exile",
                    bind: "$exiled",
                },
                {
                    op: "createTokenCopy",
                    source: { ref: "$exiled" },
                    controller: "controller",
                    except: {
                        basePower: 3,
                        baseToughness: 3,
                        additionalTypes: ["Artifact", "Creature"],
                        additionalSubtypes: ["Golem"],
                    },
                },
            ],
        }),
    ],
}));
