// `entersOrAttacksTrigger` — "Whenever this [permanent] enters or attacks":
// ONE Oracle line over two trigger events, so ONE `TriggeredAbility` with an
// array `event` (CR 603.2), the shape Sin, Spira's Punishment and Sentinel of
// the Nameless City hand-write. Two abilities would render twice on the stack
// and price the line twice in the Bot's valuation.
//
// Self only: CR 201.5 — "this permanent" is the object the ability is printed
// on, so the enters half names that permanent's own entry (CR 603.6a) and the
// attacks half its own declaration as an attacker (CR 508.3a).

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface EntersOrAttacksTriggerArgs {
    /** Stable id on the source `CardDefinition`'s `triggeredAbilities[]`. */
    id: string;
    /** Oracle text shown on the stack / in the inspector. */
    oracleText: string;
    /** CR 603.4 check-time predicate, evaluated after the head matches. */
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

/** CR 603.6a / 508.3a — the source's own entry, or its own declaration as
 *  an attacker. */
function headMatches(event: GameEvent, self: PermanentView): boolean {
    if (event.type === "PERMANENT_ENTERED") return event.instanceId === self.id;
    if (event.type === "ATTACKERS_DECLARED")
        return event.attackerIds.includes(self.id);
    return false;
}

/** Builds the "whenever this permanent enters or attacks" triggered ability. */
export function entersOrAttacksTrigger(
    args: EntersOrAttacksTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: ["PERMANENT_ENTERED", "ATTACKERS_DECLARED"],
        // Issue #4758 — the line is not an ETB-only ability: its attacks half
        // fires with the source long on the battlefield.
        etbAbility: false,
        effects: args.effects,
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event, self, state) =>
            headMatches(event, self) &&
            (args.condition === undefined ||
                args.condition(event, self, state)),
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            headMatches(event, self) && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}
