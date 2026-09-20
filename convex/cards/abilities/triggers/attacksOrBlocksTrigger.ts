// `attacksOrBlocksTrigger` — the CR 508.3a + CR 509.3a pair read as ONE
// trigger condition: "Whenever a creature attacks or blocks, …"
// (Powerstone Minefield).
//
// ── Why one ability and not two ────────────────────────────────────────────
//
// "attacks or blocks" is ONE Oracle line, so it is ONE `TriggeredAbility`
// (CR 603.2) with an array `event` — the same shape "put into a graveyard from
// anywhere" already uses. Two abilities would show two entries on the stack
// and in the inspector for a line the card prints once.
//
// ── Why the two events are already the right shape ─────────────────────────
//
// Both halves count PER CREATURE, and each reaches this factory as one event
// naming one creature:
//
//   * CR 508.3a — "Whenever [a creature] attacks" triggers for each creature
//     declared as an attacker. `ATTACKERS_DECLARED` is a BATCH event, so the
//     ability declares `perAttacker` and `collectTriggers` hands it one
//     synthetic single-attacker event per declared creature.
//   * CR 509.3a — "Whenever [a creature] blocks" triggers once each combat for
//     that creature, "even if it blocks multiple creatures". `BLOCKER_DECLARED`
//     is emitted once per blocking creature (`gre/phases.ts`), which IS that
//     rule; the per-PAIR `BLOCKERS_CONFIRMED` is not, and is deliberately not
//     read here.
//
// So the body names its creature as `{ ref: "$event.combatant" }` on either
// side — one censused field, one row per event type (ADR 0049).

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import {
    matchesPermanentScope,
    type PermanentScope,
    withTriggerGate,
} from "./shared";

export interface AttacksOrBlocksTriggerArgs {
    /** Stable id on the source `CardDefinition`'s `triggeredAbilities[]`. */
    id: string;
    /** Oracle text shown on the stack / in the inspector. */
    oracleText: string;
    /** Source-relative scope (CR 109.2), tested against the ONE creature the
     *  firing event names — the declared attacker, or the declared blocker. */
    scope: PermanentScope;
    /** CR 603.4 check-time predicate, evaluated after `scope` passes. */
    condition?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if predicate, re-evaluated at resolution. */
    interveningIf?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.3d — targets announced as the trigger goes on the stack. */
    targetRequirement?: TargetRequirement;
    /** ADR 0045 — the resolution body. */
    effects: EffectOp[];
}

/** CR 506.4 — the attacking or blocking creature the firing event is about,
 *  with its controller, or null when the event names none. The one place the
 *  two event shapes are read, so `matches` cannot disagree with the
 *  `$event.combatant` registry rows about which creature that is. */
function declaredCombatant(
    event: GameEvent
): { instanceId: string; controllerId: string } | null {
    if (event.type === "ATTACKERS_DECLARED") {
        // CR 508.1a — every declared attacker is controlled by the active
        // player, so the batch's `attackingPlayerId` IS the attacker's
        // controller. The list is length-1 under `perAttacker`; a longer one
        // is a batch this ability was not offered per-creature, and it names
        // no single creature (CR 608.2b — nothing to act on).
        if (event.attackerIds.length !== 1) return null;
        return {
            instanceId: event.attackerIds[0]!,
            controllerId: event.attackingPlayerId,
        };
    }
    if (event.type === "BLOCKER_DECLARED")
        return {
            instanceId: event.blockerId,
            controllerId: event.blockerControllerId,
        };
    return null;
}

/** Builds the CR 508.3a / 509.3a "attacks or blocks" triggered ability. */
export function attacksOrBlocksTrigger(
    args: AttacksOrBlocksTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: ["ATTACKERS_DECLARED", "BLOCKER_DECLARED"],
        perAttacker: true,
        effects: args.effects,
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            const combatant = declaredCombatant(event);
            if (combatant === null) return false;
            if (!matchesPermanentScope(args.scope, combatant, self))
                return false;
            if (args.condition && !args.condition(event, self, state))
                return false;
            return true;
        },
    };

    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) => {
            if (declaredCombatant(event) === null) return false;
            return cb(event, self, state);
        };
    }

    return withTriggerGate(ability, args);
}
