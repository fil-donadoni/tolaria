// Demonstrate (CR 702.144) — a TRIGGERED-ability keyword expanded implicitly
// from the `staticAbilities` string at the `getDefinition` seam
// (convex/cards/registry.ts), the ADR 0054 mechanism ingest and annihilator use.
// A card declares only `staticAbilities: ["demonstrate"]`; `expandDemonstrate`
// injects the cast trigger.
//
// CR 702.144a: "Demonstrate is a triggered ability. 'Demonstrate' means 'When
// you cast this spell, you may copy it and you may choose new targets for the
// copy. If you copy the spell, choose an opponent. That player copies the spell
// and may choose new targets for that copy.'"
//
// Fully declarative (DSL-first, ADR 0045): a cost-free `mayPay` gates two
// `copyResolvingSpell` Ops. From a cast trigger "the spell" is the trigger's
// source, on the stack or as its cast-time snapshot if countered in response,
// so the copies exist either way. The opponent's copy is mandatory once the
// controller copies: the text has no "may" on it. It is created second and so
// sits above the controller's: it resolves first (CR 405.2).
//
// "Choose an opponent" is not a choice in this engine: a game has exactly one
// opponent, so `player: "opponent"` names them with no prompt (no real branch).
//
// The copies' retarget offers are sequenced by `queuedCopyRetargets`
// (`gre/state/declarations.ts`): `pendingTarget` holds one selection at a time.
//
// A GRANTED demonstrate is not covered: this is a definition-level expander, so
// `isDefinitionLevelKeyword` (`oracle/lowerStatic.ts`) keeps a card that grants
// it in quarantine as `ungrantable-keyword`.

import type { CardDefinition, TriggeredAbility } from "../types";
import { spellCastTrigger } from "./triggers/spellCastTrigger";

const DEMONSTRATE_KEYWORD = "demonstrate";

/** Stable ability id: resolution reads the ability back off the definition by
 *  id. */
export const DEMONSTRATE_TRIGGER_ID = "demonstrate";

/** CR 702.144a rules text for the injected trigger, as printed in reminder
 *  text. */
export const DEMONSTRATE_ORACLE_TEXT =
    "Demonstrate (When you cast this spell, you may copy it. If you do, choose an opponent to also copy it. Players may choose new targets for their copies.)";

/** CR 702.144a — the synthesized cast trigger for one instance of demonstrate. */
export function demonstrateTrigger(): TriggeredAbility {
    return spellCastTrigger({
        id: DEMONSTRATE_TRIGGER_ID,
        oracleText: DEMONSTRATE_ORACLE_TEXT,
        scope: "self",
        effects: [
            {
                op: "mayPay",
                player: "controller",
                prompt: "Copy this spell? If you do, your opponent also copies it.",
                bind: "$demonstrated",
            },
            {
                op: "if",
                predicate: { binding: "$demonstrated" },
                then: [
                    { op: "copyResolvingSpell", player: "controller" },
                    { op: "copyResolvingSpell", player: "opponent" },
                ],
            },
        ],
    });
}

/** ADR 0054 keyword expansion — injects one cast trigger per declared instance
 *  of demonstrate. A no-op for every other card. */
export function expandDemonstrate(def: CardDefinition): CardDefinition {
    const instances = (def.staticAbilities ?? []).filter(
        (s) => s.trim().toLowerCase() === DEMONSTRATE_KEYWORD
    ).length;
    if (instances === 0) return def;
    // Idempotence guard: a definition already carrying the synthesized ability
    // must not count its instances twice.
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === DEMONSTRATE_TRIGGER_ID)) return def;
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...Array.from({ length: instances }, () => demonstrateTrigger()),
        ],
    };
}
