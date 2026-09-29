// chk — blue cards (ADR 0043 colour split). Modern Scryfall oracle text is
// authoritative (ADR 0004).

import type { CardDefinition } from "../../types";
import { phaseTrigger } from "../../abilities/triggers/phaseTrigger";

// Honden of Seeing Winds — "At the beginning of your upkeep, draw a card for
// each Shrine you control." DSL-only TRIGGERED ability (ADR 0045, issue #803):
// the effect is a declarative Effect Script executed by the interpreter through
// the SAME code path as spell-site scripts. The "for each Shrine" is the frozen
// `count` construct (CR 122) — a battlefield count of the controller's Shrines
// (the Honden itself is a Shrine, CR 205.3, so it counts) — feeding the `draw`
// Op's count (CR 121.1). `scope: "your"` makes the trigger's controller the
// upkeep player, so the script's `player: "controller"` is exactly "you"
// (CR 603.6a).
export const hondenOfSeeingWinds: CardDefinition = {
    id: "ad732186-eeb9-4edb-a17a-51f8bac71802",
    rarity: "uncommon",
    name: "Honden of Seeing Winds",
    oracleText:
        "At the beginning of your upkeep, draw a card for each Shrine you control.",
    manaCost: { X: 4, U: 1 },
    types: ["Enchantment"],
    supertypes: ["Legendary"],
    subtypes: ["Shrine"],
    triggeredAbilities: [
        phaseTrigger({
            id: "honden-of-seeing-winds-upkeep",
            oracleText:
                "At the beginning of your upkeep, draw a card for each Shrine you control.",
            phase: "UPKEEP",
            scope: "your",
            effects: [
                {
                    op: "draw",
                    player: "controller",
                    count: {
                        count: {
                            zone: "battlefield",
                            controller: "controller",
                            filter: { subtype: "Shrine" },
                        },
                    },
                },
            ],
        }),
    ],
};
