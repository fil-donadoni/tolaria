// Ingest (CR 702.115) — a TRIGGERED-ability keyword expanded implicitly from
// the `staticAbilities` string at the `getDefinition` seam
// (convex/cards/registry.ts), the ADR 0054 mechanism annihilator and myriad
// use. A card declares only `staticAbilities: ["ingest"]`; `expandIngest`
// injects the combat-damage trigger.
//
// CR 702.115a: "Ingest is a triggered ability. 'Ingest' means 'Whenever this
// creature deals combat damage to a player, that player exiles the top card of
// their library.'"
// CR 702.115b: "If a creature has multiple instances of ingest, each triggers
// separately."
//
// "THAT PLAYER" IS THE DAMAGED PLAYER, read off the event
// (`$event.damagedPlayer`), never the bare `"opponent"`: a redirection can send
// the combat damage to the creature's own controller, who then exiles from
// their own library.
//
// Fully declarative (DSL-first, ADR 0045): one `exileTopOfLibrary` Op, whose
// empty library is a clean no-op (CR 608.2b). The exiled card is face up
// (CR 406.3): the text says nothing else.
//
// A GRANTED ingest is not covered: this is a definition-level expander, so
// `isDefinitionLevelKeyword` (`oracle/lowerStatic.ts`) keeps a card that grants
// it in quarantine as `ungrantable-keyword`.

import type { CardDefinition, TriggeredAbility } from "../types";
import { damageDealtTrigger } from "./triggers/damageDealtTrigger";

const INGEST_KEYWORD = "ingest";

/** Stable ability id: resolution reads the ability back off the definition by
 *  id, and two instances sharing a `triggerOrderKey` (`gre/triggers.ts`)
 *  auto-order, since nothing separates their outcomes (ADR 0003). */
export const INGEST_TRIGGER_ID = "ingest";

/** CR 702.115a rules text for the injected trigger, as printed in reminder
 *  text. */
export const INGEST_ORACLE_TEXT =
    "Ingest (Whenever this creature deals combat damage to a player, that player exiles the top card of their library.)";

/** CR 702.115a — the synthesized combat-damage trigger for one instance of
 *  ingest. */
export function ingestTrigger(): TriggeredAbility {
    return damageDealtTrigger({
        id: INGEST_TRIGGER_ID,
        oracleText: INGEST_ORACLE_TEXT,
        source: "self",
        target: { kind: "player", player: { relation: "any" } },
        isCombat: true,
        effects: [
            {
                op: "exileTopOfLibrary",
                player: { ref: "$event.damagedPlayer" },
            },
        ],
    });
}

/** ADR 0054 keyword expansion — injects one combat-damage trigger per declared
 *  instance of ingest (CR 702.115b counts every matching string, not the
 *  first). A no-op for every other card. */
export function expandIngest(def: CardDefinition): CardDefinition {
    const instances = (def.staticAbilities ?? []).filter(
        (s) => s.trim().toLowerCase() === INGEST_KEYWORD
    ).length;
    if (instances === 0) return def;
    // Idempotence guard: a definition already carrying the synthesized
    // abilities must not over-count CR 702.115b.
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === INGEST_TRIGGER_ID)) return def;
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...Array.from({ length: instances }, () => ingestTrigger()),
        ],
    };
}
