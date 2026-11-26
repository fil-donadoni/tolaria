// `entersOrUpkeepTrigger` — "When this [permanent] enters and at the beginning
// of your upkeep": ONE Oracle line over two trigger events, so ONE
// `TriggeredAbility` with an array `event` (CR 603.2), the shape Minsc & Boo,
// Timeless Heroes hand-writes. Two abilities would render twice on the stack
// and price the line twice in the Bot's valuation.
//
// Self only: CR 201.5 — "this permanent" is the object the ability is printed
// on, so the enters half names that permanent's own entry (CR 603.6a); the
// upkeep half fires at the beginning of its controller's upkeep (CR 603.2b).

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface EntersOrUpkeepTriggerArgs {
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

/** CR 603.6a / 603.2b — the source's own entry, or the beginning of its
 *  controller's upkeep. */
function headMatches(event: GameEvent, self: PermanentView): boolean {
    if (event.type === "PERMANENT_ENTERED") return event.instanceId === self.id;
    if (event.type === "PHASE_BEGIN")
        return (
            event.phase === "UPKEEP" &&
            event.activePlayerId === self.controllerId
        );
    return false;
}

/** Builds the "when this permanent enters and at the beginning of your
 *  upkeep" triggered ability. */
export function entersOrUpkeepTrigger(
    args: EntersOrUpkeepTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: ["PERMANENT_ENTERED", "PHASE_BEGIN"],
        // Issue #4758 — the line is not an ETB-only ability: its upkeep half
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
