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
//   * Persist (CR 702.79a, issue #1372) — "When this permanent is put into a
//     graveyard from the battlefield, if it had no -1/-1 counters on it,
//     return it to the battlefield under its owner's control with a -1/-1
//     counter on it." Not a pump: see `persistTrigger`'s own doc.

import type {
    CardDefinition,
    EffectObjectSelector,
    EffectOp,
    PermanentLeftEvent,
    TriggeredAbility,
} from "../types";
import { attacksTrigger } from "./triggers/attacksTrigger";
import { leftTrigger } from "./triggers/leftTrigger";
import { spellCastTrigger } from "./triggers/spellCastTrigger";

const EXALTED_KEYWORD = "exalted";
const PROWESS_KEYWORD = "prowess";
const BATTLE_CRY_KEYWORD = "battle cry";
const PERSIST_KEYWORD = "persist";

const EXALTED_TRIGGER_ID = "exalted";
const PROWESS_TRIGGER_ID = "prowess";
const BATTLE_CRY_TRIGGER_ID = "battle-cry";
const PERSIST_TRIGGER_ID = "persist";

/** The counter kind Persist both checks for and returns with (CR 702.79a). */
const MINUS_ONE_COUNTER = "-1/-1";

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
 *  RESOLVES, frozen there: CR 608.2h — information the effect requires is
 *  determined only once, when the effect is applied — and CR 611.2c, which
 *  fixes the set a resolution-generated continuous effect affects at the
 *  moment it begins. That is the rules-correct reading of "each other
 *  attacking creature": a creature put onto the battlefield attacking while
 *  the trigger is still on the stack IS attacking when it resolves and does
 *  get the buff; one that enters attacking afterwards does not, and neither
 *  does one that has left combat by then (CR 608.2h again — the ability is
 *  untargeted, so CR 608.2b's target-legality check never applies to it).
 *
 *  `controller: "controller"` narrows the scan to the trigger controller's
 *  own battlefield. CR 508.1a already guarantees that is where every attacker
 *  is — the source can only have triggered by attacking, so its controller IS
 *  the active player — but stating it makes the selector fail CLOSED: any
 *  future path that left `isAttacking` set on a defender-controlled permanent
 *  would otherwise pump an enemy creature.
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
                    controller: "controller",
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

/** Persist's CR 702.79a triggered ability.
 *
 *  THE EVENT. "This permanent is put into a graveyard from the battlefield" —
 *  a `PERMANENT_LEFT` with `toZone: "graveyard"`, NOT `CREATURE_DIED`: the rule
 *  says permanent, and a persist creature that has stopped being a creature
 *  (made a land, say) still persists when it is destroyed. A departure a
 *  replacement sends elsewhere (exiled instead — CR 614) is not one, and the
 *  event's `toZone` already says so. The source itself is gone when this
 *  triggers; it is a leaves-the-battlefield ability, which "looks back in
 *  time" (CR 603.10a), so the scan finds it on the object as it last existed.
 *
 *  THE CONDITION. "If it had no -1/-1 counters on it" is an intervening-if
 *  (CR 603.4 — checked as it triggers and again on resolution) read off the
 *  event's `countersBeforeLeave` last known information. Never off the card in
 *  the graveyard: that is a new object (CR 400.7) whose counters ceased to
 *  exist (CR 122.2), so the condition would always hold and the permanent
 *  would return forever. The event snapshot is immutable, so the re-check at
 *  resolution answers exactly as the first one did. A -1/-1 counter removed
 *  by CR 704.5q annihilation in an EARLIER state-based-action check is gone
 *  (the creature persists again — the Kitchen Finks loop); one annihilated in
 *  the SAME check that killed it is still in the snapshot (CR 704.8).
 *
 *  THE RETURN. One `moveZone` of `$source` from the graveyard to the
 *  battlefield — the `enduringReturnTrigger` shape. "Under its OWNER's
 *  control" is that branch's default (the card is in its owner's graveyard,
 *  CR 400.7 / 108.3), and naming `controller` would be the bug: the trigger is
 *  controlled by whoever last controlled the permanent (CR 603.3a), not its
 *  owner. "With a -1/-1 counter on it" is `entersWithCounters`, given AS it
 *  enters (CR 122.6 / 614.1c), so the entry event and every "whenever a
 *  creature enters" watcher see it — a Woodfall Primus comes back a 5/5,
 *  never momentarily a 6/6. It is a new object (CR 400.7): no damage, no old
 *  counters, no attachments, summoning sick. A card that has left the
 *  graveyard before resolution is a new object the ability cannot find
 *  (CR 400.7), and a token is never returned (CR 111.7): the Op is a clean
 *  no-op either way.
 *
 *  CR 702.79a's multiple-instance case (each instance triggers; the second
 *  finds no card) is unreachable by construction, as for battle cry: a
 *  `staticAbilities` list is a set of strings and this ability has ONE id. */
function hadNoMinusOneCounter(event: PermanentLeftEvent): boolean {
    return (event.countersBeforeLeave?.[MINUS_ONE_COUNTER] ?? 0) <= 0;
}

function persistTrigger(): TriggeredAbility {
    return leftTrigger({
        id: PERSIST_TRIGGER_ID,
        oracleText:
            "Persist (When this creature dies, if it had no -1/-1 counters on it, return it to the battlefield under its owner's control with a -1/-1 counter on it.)",
        scope: "self",
        toZone: "graveyard",
        // CR 603.4 — checked as it triggers (`condition`: a persister that
        // died with a -1/-1 counter never goes on the stack) AND again on
        // resolution (`interveningIf`).
        condition: hadNoMinusOneCounter,
        interveningIf: hadNoMinusOneCounter,
        effects: [
            {
                op: "moveZone",
                target: { ref: "$source" },
                from: "graveyard",
                to: "battlefield",
                entersWithCounters: { [MINUS_ONE_COUNTER]: 1 },
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

/** Expands a card carrying `exalted` / `prowess` / `battle cry` / `persist` into a
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
    const hasPersist = hasKeyword(def.staticAbilities, PERSIST_KEYWORD);
    if (!hasExalted && !hasProwess && !hasBattleCry && !hasPersist) return def;

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
    if (hasPersist && !existing.some((t) => t.id === PERSIST_TRIGGER_ID)) {
        injected.push(persistTrigger());
    }
    if (injected.length === 0) return def;

    return {
        ...def,
        triggeredAbilities: [...existing, ...injected],
    };
}
