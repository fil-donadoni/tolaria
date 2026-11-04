// Myriad (CR 702.116) — a TRIGGERED-ability keyword expanded implicitly from
// the `staticAbilities` string at the `getDefinition` seam
// (convex/cards/registry.ts), the ADR 0054 mechanism annihilator and mobilize
// use. A card declares only `staticAbilities: ["myriad"]`; `expandMyriad`
// injects the attack trigger.
//
// CR 702.116a: "Whenever this creature attacks, for each opponent other than
// defending player, you may create a token that's a copy of this creature
// that's tapped and attacking that player or a planeswalker they control. If
// one or more tokens are created this way, exile the tokens at end of combat."
// CR 702.116b: "If a creature has multiple instances of myriad, each triggers
// separately."
//
// THE BODY IS EMPTY, AND THAT IS THE RULE: in a two-player game the nonactive
// player is the defending player (CR 506.2), so the set "each opponent other
// than defending player" has no member and no token is ever offered. This
// engine plays two-player games only (docs/PROJECT.md § Fuori scope), so the
// token creation and its delayed exile are unreachable, and no Op is written
// for a branch that cannot run.
//
// THE TRIGGER STILL EXISTS: myriad is a triggered ability whatever its effect
// comes to, so it goes on the stack the next time a player would receive
// priority (CR 603.3), where it can be responded to and resolves doing nothing.
//
// A GRANTED myriad is not covered: this is a definition-level expander, so
// `isDefinitionLevelKeyword` (`oracle/lowerStatic.ts`) keeps a card that grants
// it in quarantine as `ungrantable-keyword`.

import type { CardDefinition, TriggeredAbility } from "../types";
import { attacksTrigger } from "./triggers/attacksTrigger";

const MYRIAD_KEYWORD = "myriad";

/** Stable ability id: resolution reads the ability back off the definition by
 *  id, and two instances sharing a `triggerOrderKey` (`gre/triggers.ts`)
 *  auto-order, since nothing separates their outcomes (ADR 0003). */
export const MYRIAD_TRIGGER_ID = "myriad";

/** CR 702.116a rules text for the injected trigger, as printed in reminder
 *  text. */
export const MYRIAD_ORACLE_TEXT =
    "Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token copy that's tapped and attacking that player or a planeswalker they control. Exile the tokens at end of combat.)";

/** CR 702.116a — the synthesized attack trigger for one instance of myriad. */
export function myriadTrigger(): TriggeredAbility {
    return attacksTrigger({
        id: MYRIAD_TRIGGER_ID,
        oracleText: MYRIAD_ORACLE_TEXT,
        scope: "self",
        effects: [],
    });
}

/** ADR 0054 keyword expansion — injects one attack trigger per declared
 *  instance of myriad (CR 702.116b counts every matching string, not the
 *  first). A no-op for every other card. */
export function expandMyriad(def: CardDefinition): CardDefinition {
    const instances = (def.staticAbilities ?? []).filter(
        (s) => s.trim().toLowerCase() === MYRIAD_KEYWORD
    ).length;
    if (instances === 0) return def;
    // Idempotence guard: a definition already carrying the synthesized
    // abilities must not over-count CR 702.116b.
    const existing = def.triggeredAbilities ?? [];
    if (existing.some((t) => t.id === MYRIAD_TRIGGER_ID)) return def;
    return {
        ...def,
        triggeredAbilities: [
            ...existing,
            ...Array.from({ length: instances }, () => myriadTrigger()),
        ],
    };
}
