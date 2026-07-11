// Aetherdrift (DFT) — red cards, split by colour per ADR 0043. The registry's
// `import * as dft from "./sets/dft"` resolves through dft/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";
import { cyclingAbility } from "../../abilities/cycling";
import { discardTrigger } from "../../abilities/triggers/discardTrigger";

// Marauding Mako — {R} Creature — Shark Pirate, 1/1. "Whenever you discard one
// or more cards, put that many +1/+1 counters on this creature." plus Cycling
// {1} (CR 702.29). The discard trigger rides the CR 701.8 CARD_DISCARDED event
// (one per discarded card); cycling any card — including this one — flows
// through the shared discard choke point, so cycling ANOTHER card while the
// Mako is on the battlefield grows it (issue #689).
//
// Simplification (documented): the engine emits one CARD_DISCARDED per card, so
// a simultaneous "discard N cards" fires this trigger N times (one +1/+1 counter
// each) rather than once with a count of N. The net counter total is identical;
// only single-card discards occur in this batch (Cycling always discards one).
export const maraudingMako: CardDefinition = {
    id: "194ebb23-fecd-4aa5-96b7-447c9768794e",
    name: "Marauding Mako",
    rarity: "common",
    oracleText:
        "Whenever you discard one or more cards, put that many +1/+1 counters on this creature.\nCycling {1} ({1}, Discard this card: Draw a card.)",
    manaCost: { R: 1 },
    types: ["Creature"],
    subtypes: ["Shark", "Pirate"],
    power: 1,
    toughness: 1,
    triggeredAbilities: [
        discardTrigger({
            id: "marauding-mako-discard",
            oracleText:
                "Whenever you discard one or more cards, put that many +1/+1 counters on this creature.",
            scope: "your",
            resolve: (ctx: SpellContext) => {
                // CR 122.1 — one +1/+1 counter per discarded card (this fires
                // once per CARD_DISCARDED event).
                ctx.addCounter(
                    { type: "permanent", id: ctx.sourceInstanceId },
                    "+1/+1",
                    1
                );
            },
        }),
    ],
    // CR 702.29 — Cycling {1}. Usable only from hand at instant speed.
    activatedAbilities: [cyclingAbility({ generic: 1 })],
};
