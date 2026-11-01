// `entersOrLeavesTrigger` — "When this [permanent] enters or leaves the
// battlefield": ONE Oracle line over two trigger events, so ONE
// `TriggeredAbility` with an array `event` (CR 603.2), the shape
// `entersOrAttacksTrigger` already gives "enters or attacks".
//
// Self only: CR 201.5 — "this permanent" is the object the ability is printed
// on. The enters half is its own entry (CR 603.6a); the leaves half its own
// move from the battlefield to ANY zone (CR 603.6c), which looks back in time
// (CR 603.10a) — `collectTriggers` finds the departed source in the zone it
// reached, exactly as it does for `leftTrigger({ scope: "self" })`.
import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface EntersOrLeavesTriggerArgs {
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

/** CR 603.6a / 603.6c — the source's own entry, or its own departure. */
function headMatches(event: GameEvent, self: PermanentView): boolean {
    if (event.type === "PERMANENT_ENTERED") return event.instanceId === self.id;
    if (event.type === "PERMANENT_LEFT") return event.instanceId === self.id;
    return false;
}

/** Builds the "when this permanent enters or leaves the battlefield" ability. */
export function entersOrLeavesTrigger(
    args: EntersOrLeavesTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: ["PERMANENT_ENTERED", "PERMANENT_LEFT"],
        // Not an ETB Ability (GLOSSARY.md): the leaves half fires again on
        // the way out, so the line is not spent on entering.
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
