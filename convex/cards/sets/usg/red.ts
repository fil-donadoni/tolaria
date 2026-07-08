// usg — red cards (ADR 0043 colour split).
//
// Modern Scryfall oracle text is authoritative (ADR 0004). Goblin Patrol's
// echo cost is {R} under the modern errata (the original printing read a bare
// "Echo", errata'd to the explicit mana-cost payment).

import type { CardDefinition } from "../../types";
import { echoTrigger } from "../../abilities/echo";

// Goblin Patrol — {R} 2/1 Goblin with Echo {R} (CR 702.30). Home set is Urza's
// Saga, its earliest paper printing (ADR 0041 routes a card to that set); the
// print id below is the usg printing (Premodern-legal, in the CR-legal pool).
export const goblinPatrol: CardDefinition = {
    id: "d0fcd8d3-f159-49a1-8dd9-582ae4a0adc3",
    name: "Goblin Patrol",
    rarity: "common",
    oracleText:
        "Echo {R} (At the beginning of your upkeep, if this came under your control since the beginning of your last upkeep, sacrifice it unless you pay its echo cost.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Goblin"],
    power: 2,
    toughness: 1,
    // CR 702.30 — the `echo` keyword string drives the ETB `echoPending` flag
    // (state.ts); the trigger template below performs the upkeep pay-or-sac.
    staticAbilities: ["echo"],
    triggeredAbilities: [
        echoTrigger({
            id: "goblin-patrol-echo",
            cost: { R: 1 },
            costLabel: "{R}",
        }),
    ],
};
