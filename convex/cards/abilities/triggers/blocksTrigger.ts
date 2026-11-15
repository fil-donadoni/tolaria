// `blocksTrigger` — factory for `BLOCKER_DECLARED` triggered abilities: "when
// this creature blocks". CR 509.3a — a "blocks" trigger fires only once each
// combat for that creature, even if it blocks multiple creatures, on its
// declaration as a blocker. The engine emits ONE `BLOCKER_DECLARED` per
// blocking creature (`gre/phases.ts`), which IS that rule; the per-pair
// `BLOCKERS_CONFIRMED` is not, and is deliberately not read here. The event
// names exactly one creature, so the scope test is identity with the source:
// this factory models the self-subject head only.

import type {
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { withTriggerGate } from "./shared";

export interface BlocksTriggerArgs {
    id: string;
    oracleText: string;
    /** CR 603.4 check-time predicate. */
    condition?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4 intervening-if, re-checked at resolution. */
    interveningIf?: (
        event: GameEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.3d — targets announced as the trigger goes on the stack. */
    targetRequirement?: TargetRequirement;
    /** Effect Script (ADR 0045). */
    effects: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `BLOCKER_DECLARED`
 *  (CR 509.3a) on the source itself. */
export function blocksTrigger(args: BlocksTriggerArgs): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "BLOCKER_DECLARED",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "BLOCKER_DECLARED") return false;
            if (event.blockerId !== self.id) return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        effects: args.effects,
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            event.type === "BLOCKER_DECLARED" && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}
