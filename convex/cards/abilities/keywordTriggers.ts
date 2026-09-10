// Exalted (CR 702.83), Prowess (CR 702.108) & Battle cry (CR 702.91) —
// triggered-ability keywords expanded implicitly from a single
// `staticAbilities` string at the `getDefinition` seam (convex/cards/index.ts),
// the same ADR 0054 mechanism fading/vanishing use. A card declares only
// `staticAbilities: ["exalted"]` / `["prowess"]` / `["battle cry"]`;
// `expandKeywordTriggers` injects the synthesized triggered ability so the
// keyword's rules text lives in exactly one place — the string.
// Issues #699 / #3222.
//
// All three resolve to the shipped `pump` Op (CR 613.4c, until-end-of-turn
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
//   * Battle cry (CR 702.91a) — "Whenever this creature attacks, each other
//     attacking creature gets +1/+0 until end of turn." An `attacksTrigger`
//     (CR 508.1m) with `scope: "self"`, whose body is a `forEach` over the
//     battlefield filtered to `isAttacking` with `excludeSource` — "each
//     OTHER attacking creature" — pumping +1/+0. CR 702.91b (multiple
//     instances trigger separately) is out of reach by construction: a
//     `staticAbilities` list is a set of strings and the injected ability
//     carries ONE fixed id, so a card printing battle cry twice would need
//     the `expandAnnihilator` count-every-match shape; no card in the pool
//     does, and the vocabulary would have to grow a second spelling anyway.

import type {
    CardDefinition,
    EffectObjectSelector,
    EffectOp,
    TriggeredAbility,
} from "../types";
import { attacksTrigger } from "./triggers/attacksTrigger";
import { spellCastTrigger } from "./triggers/spellCastTrigger";

const EXALTED_KEYWORD = "exalted";
const PROWESS_KEYWORD = "prowess";
const BATTLE_CRY_KEYWORD = "battle cry";

const EXALTED_TRIGGER_ID = "exalted";
const PROWESS_TRIGGER_ID = "prowess";
const BATTLE_CRY_TRIGGER_ID = "battle-cry";

/** +1/+1 until end of turn (CR 613.4c) — the shared pump payload exalted and
 *  prowess apply, differing only in target. */
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

/** Battle cry's CR 702.91a triggered ability: whenever the source attacks,
 *  every OTHER attacking creature gets +1/+0 until end of turn.
 *
 *  The member set is a fresh battlefield scan taken when the trigger
 *  RESOLVES, frozen there (CR 608.2i — information is determined once, as the
 *  effect is applied). That is the rules-correct reading of "each other
 *  attacking creature": a creature put onto the battlefield attacking while
 *  the trigger is still on the stack IS attacking when it resolves and does
 *  get the buff; one that enters attacking afterwards does not, and neither
 *  does one that has left combat by then (CR 608.2b).
 *
 *  No `controller` on the selector: CR 508.1a lets only the active player
 *  declare attackers, so every attacking creature is already the source's
 *  controller's — scoping the scan would be a second authority on that fact.
 *  `excludeSource` is what makes it "each OTHER" (CR 702.91a); without it a
 *  lone battle-cry attacker would pump itself. Two battle-cry creatures
 *  attacking together each drop THEMSELVES from their own scan and so pump
 *  the other, which is exactly the printed behaviour. */
function battleCryTrigger(): TriggeredAbility {
    return attacksTrigger({
        id: BATTLE_CRY_TRIGGER_ID,
        oracleText:
            "Whenever this creature attacks, each other attacking creature gets +1/+0 until end of turn.",
        scope: "self",
        effects: [
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Creature", isAttacking: true },
                    excludeSource: true,
                },
                effects: [
                    {
                        op: "pump",
                        target: { ref: "$each" },
                        power: 1,
                        toughness: 0,
                        duration: { phase: "end-of-turn" },
                    },
                ],
            },
        ],
    });
}

/** Case-insensitively tests whether a `staticAbilities` list carries `keyword`
 *  as a bare string (CR 702 keyword abilities are declared lowercase). */
function hasKeyword(
    staticAbilities: string[] | undefined,
    keyword: string
): boolean {
    return staticAbilities?.some((a) => a.toLowerCase() === keyword) ?? false;
}

/** Expands a card carrying `exalted` / `prowess` / `battle cry` into a
 *  definition that also carries the synthesized triggered ability. Returns the
 *  input unchanged when no such keyword is present. Never mutates the input —
 *  clones only `triggeredAbilities`, so the base definition stays shared.
 *  Idempotent by construction (the `getDefinition` seam memo dedups) and
 *  additionally guarded against double-injection by the trigger-id presence
 *  check. A card may carry several of the keywords; every matching trigger is
 *  injected. */
export function expandKeywordTriggers(def: CardDefinition): CardDefinition {
    const hasExalted = hasKeyword(def.staticAbilities, EXALTED_KEYWORD);
    const hasProwess = hasKeyword(def.staticAbilities, PROWESS_KEYWORD);
    const hasBattleCry = hasKeyword(def.staticAbilities, BATTLE_CRY_KEYWORD);
    if (!hasExalted && !hasProwess && !hasBattleCry) return def;

    const existing = def.triggeredAbilities ?? [];
    const injected: TriggeredAbility[] = [];
    if (hasExalted && !existing.some((t) => t.id === EXALTED_TRIGGER_ID)) {
        injected.push(exaltedTrigger());
    }
    if (hasProwess && !existing.some((t) => t.id === PROWESS_TRIGGER_ID)) {
        injected.push(prowessTrigger());
    }
    if (hasBattleCry && !existing.some((t) => t.id === BATTLE_CRY_TRIGGER_ID)) {
        injected.push(battleCryTrigger());
    }
    if (injected.length === 0) return def;

    return {
        ...def,
        triggeredAbilities: [...existing, ...injected],
    };
}
