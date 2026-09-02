// Aetherdrift (DFT) — red cards, split by colour per ADR 0043. The registry's
// `import * as dft from "./sets/dft"` resolves through dft/index.ts. Modern
// Scryfall oracle text is authoritative (ADR 0004).
import type { CardDefinition, SpellContext } from "../../types";
import { cyclingAbility } from "../../abilities/cycling";
import { discardTrigger } from "../../abilities/triggers/discardTrigger";

// Marauding Mako — {R} Creature — Shark Pirate, 1/1. "Whenever you discard one
// or more cards, put that many +1/+1 counters on this creature." plus Cycling
// {1} (CR 702.29). The discard trigger rides the CR 701.9 CARD_DISCARDED event
// (one per discarded card); cycling any card — including this one — flows
// through the shared discard choke point, so cycling ANOTHER card while the
// Mako is on the battlefield grows it (issue #689).
//
// Simplification (tracked-by: #2785) (documented): the engine emits one CARD_DISCARDED per card, so
// a simultaneous "discard N cards" fires this trigger N times (one +1/+1 counter
// each) rather than once with a count of N. The net counter total is identical;
// only single-card discards occur in this batch (Cycling always discards one).
export const maraudingMako: CardDefinition = {
    id: "9efbfd67-e0f5-43e0-9fff-1eb4a2bed0d8",
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
        // NOT-DSL-migratable (ADR 0045) today, despite a body that is a single
        // covered Op: the ability is built via the `discardTrigger` factory,
        // whose `DiscardTriggerArgs` declares `resolve` as a MANDATORY field
        // and exposes no `effects?: EffectOp[]` site (unlike `spellCastTrigger`
        // / `enteredTrigger` / `tappedTrigger`, which already accept
        // `effects`). Blocked on: `discardTrigger` gaining that param — an
        // engine change, out of scope for a single-card migration. The marker
        // is what keeps the migration classifier honest: its clause-mapper
        // reads only the closure body, never the factory, so without this note
        // the card resurfaces as FREE every pass. tracked-by: #1437.
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
