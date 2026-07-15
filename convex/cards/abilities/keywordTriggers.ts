// Exalted (CR 702.83) & Prowess (CR 702.108) — triggered-ability keywords
// expanded implicitly from a single `staticAbilities` string at the
// `getDefinition` seam (convex/cards/index.ts), the same ADR 0054 mechanism
// fading/vanishing use. A card declares only `staticAbilities: ["exalted"]` /
// `["prowess"]`; `expandKeywordTriggers` injects the synthesized triggered
// ability so the keyword's rules text lives in exactly one place — the string.
// Issue #699.
//
// Both keywords resolve to the shipped `pump` Op (CR 613.4c, until-end-of-turn
// P/T buff via SpellContext.addTemporaryPTBuff) and are therefore fully
// declarative (DSL-first, ADR 0045) — no `resolve()` closure:
//
//   * Exalted (CR 702.83a) — "Whenever a creature you control attacks alone,
//     that creature gets +1/+1 until end of turn." Fires on ATTACKERS_DECLARED
//     when exactly one creature was declared AND its controller is this
//     permanent's controller (CR 508.1 / 109.4). The pumped creature is the
//     LONE ATTACKER, which need not be the exalted source itself, so the pump
//     targets `{ ref: "$event.soleAttacker" }` — the ATTACKERS_DECLARED
//     event-field row (ADR 0049, EVENT_FIELD_REGISTRY) that flattens
//     `attackerIds` to its single member.
//   * Prowess (CR 702.108a) — "Whenever you cast a noncreature spell, this
//     creature gets +1/+1 until end of turn." A SPELL_CAST trigger (scope
//     "you", filter excludeTypes "Creature") pumping the source itself.

import type {
    CardDefinition,
    EffectObjectSelector,
    EffectOp,
    TriggeredAbility,
} from "../types";
import { spellCastTrigger } from "./triggers/spellCastTrigger";

const EXALTED_KEYWORD = "exalted";
const PROWESS_KEYWORD = "prowess";

const EXALTED_TRIGGER_ID = "exalted";
const PROWESS_TRIGGER_ID = "prowess";

/** +1/+1 until end of turn (CR 613.4c) — the shared pump payload both keywords
 *  apply, differing only in target. */
function pumpPlusOne(target: EffectObjectSelector): EffectOp {
    return {
        op: "pump",
        target,
        power: 1,
        toughness: 1,
        duration: { phase: "end-of-turn" },
    };
}

/** Exalted's CR 702.83a triggered ability: pump the lone attacker +1/+1 EOT. */
function exaltedTrigger(): TriggeredAbility {
    return {
        id: EXALTED_TRIGGER_ID,
        oracleText:
            "Whenever a creature you control attacks alone, that creature gets +1/+1 until end of turn.",
        event: "ATTACKERS_DECLARED",
        matches: (event, self) =>
            event.type === "ATTACKERS_DECLARED" &&
            event.attackerIds.length === 1 &&
            event.attackingPlayerId === self.controllerId,
        effects: [pumpPlusOne({ ref: "$event.soleAttacker" })],
    };
}

/** Prowess's CR 702.108a triggered ability: pump the source +1/+1 EOT whenever
 *  its controller casts a noncreature spell. */
function prowessTrigger(): TriggeredAbility {
    return spellCastTrigger({
        id: PROWESS_TRIGGER_ID,
        oracleText:
            "Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.",
        scope: "you",
        filter: { excludeTypes: "Creature" },
        effects: [pumpPlusOne({ ref: "$source" })],
    });
}

/** Case-insensitively tests whether a `staticAbilities` list carries `keyword`
 *  as a bare string (CR 702 keyword abilities are declared lowercase). */
function hasKeyword(
    staticAbilities: string[] | undefined,
    keyword: string
): boolean {
    return (
        staticAbilities?.some((a) => a.toLowerCase() === keyword) ?? false
    );
}

/** Expands a card carrying `exalted` / `prowess` into a definition that also
 *  carries the synthesized triggered ability. Returns the input unchanged when
 *  neither keyword is present. Never mutates the input — clones only
 *  `triggeredAbilities`, so the base definition stays shared. Idempotent by
 *  construction (the `getDefinition` seam memo dedups) and additionally guarded
 *  against double-injection by the trigger-id presence check. A card may carry
 *  both keywords; both triggers are injected. */
export function expandKeywordTriggers(def: CardDefinition): CardDefinition {
    const hasExalted = hasKeyword(def.staticAbilities, EXALTED_KEYWORD);
    const hasProwess = hasKeyword(def.staticAbilities, PROWESS_KEYWORD);
    if (!hasExalted && !hasProwess) return def;

    const existing = def.triggeredAbilities ?? [];
    const injected: TriggeredAbility[] = [];
    if (hasExalted && !existing.some((t) => t.id === EXALTED_TRIGGER_ID)) {
        injected.push(exaltedTrigger());
    }
    if (hasProwess && !existing.some((t) => t.id === PROWESS_TRIGGER_ID)) {
        injected.push(prowessTrigger());
    }
    if (injected.length === 0) return def;

    return {
        ...def,
        triggeredAbilities: [...existing, ...injected],
    };
}
