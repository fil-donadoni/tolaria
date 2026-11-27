// `becameTargetTrigger` — factory for `BECAME_TARGET` triggered abilities:
// "whenever this creature becomes the target of a spell or ability". CR 603.2
// + CR 115.1 — the engine emits one `BECAME_TARGET` per target as a spell's or
// ability's targets are locked (cast, activation, trigger announcement), so
// the event names exactly one object and the scope test is identity with the
// source. Not narrowed to an opponent's spell or ability: that narrowing is
// Ward's own (CR 702.21a), and this wording says plainly "a spell or ability".
// `scope: "host"` (CR 303.4b) is the Aura's twin, "when enchanted creature
// becomes the target of a spell or ability": the targeted object is the
// permanent the source is attached to. `scope: "yours"` is "whenever a
// creature you control becomes the target of …": the targeted permanent is a
// creature the source's controller controls (`targetControllerId`, resolved
// at emit time; the creature type read off the live view, failing closed).
// `by` (CR 109.4) narrows the targeting spell or ability to one its
// controller ("you control") or an opponent ("an opponent controls")
// controls, read off `sourceControllerId`.

import type {
    BecameTargetEvent,
    EffectOp,
    GameEvent,
    PermanentView,
    TargetRequirement,
    TriggeredAbility,
    TriggerStateView,
} from "../../types";
import { findPermanentInView, withTriggerGate } from "./shared";

export interface BecameTargetTriggerArgs {
    id: string;
    oracleText: string;
    /** Whose targeting fires it: the source itself (absent), the
     *  permanent the source is attached to (`host`, CR 303.4b), or any
     *  creature the source's controller controls (`yours`). */
    scope?: "host" | "yours";
    /** CR 109.4 — whose spell or ability did the targeting: the source's
     *  controller (`you`), an opponent of theirs (`opponent`), or anyone's
     *  (absent). */
    by?: "you" | "opponent";
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
    /** CR 603.2 — "This ability triggers only N times each turn", counted per
     *  source object (`TriggeredAbility.maxTriggersPerTurn`). */
    maxTriggersPerTurn?: number;
    /** Effect Script (ADR 0045). */
    effects: EffectOp[];
}

/** Builds a `TriggeredAbility` listening for `BECAME_TARGET` (CR 603.2) on
 *  the source itself, or on its attachment host (`scope: "host"`). */
export function becameTargetTrigger(
    args: BecameTargetTriggerArgs
): TriggeredAbility {
    const ability: TriggeredAbility = {
        id: args.id,
        oracleText: args.oracleText,
        event: "BECAME_TARGET",
        ...(args.targetRequirement
            ? { targetRequirement: args.targetRequirement }
            : {}),
        matches: (event: GameEvent, self, state) => {
            if (event.type !== "BECAME_TARGET") return false;
            if (event.target.type !== "permanent") return false;
            if (!targetedPermanentInScope(event, self, state, args.scope))
                return false;
            if (
                args.by === "you" &&
                event.sourceControllerId !== self.controllerId
            )
                return false;
            if (
                args.by === "opponent" &&
                event.sourceControllerId === self.controllerId
            )
                return false;
            return args.condition ? args.condition(event, self, state) : true;
        },
        ...(args.maxTriggersPerTurn !== undefined
            ? { maxTriggersPerTurn: args.maxTriggersPerTurn }
            : {}),
        effects: args.effects,
    };
    if (args.interveningIf) {
        const cb = args.interveningIf;
        ability.interveningIf = (event, self, state) =>
            event.type === "BECAME_TARGET" && cb(event, self, state);
    }
    return withTriggerGate(ability, args);
}

/** The targeted permanent is the one `scope` watches: the source itself, its
 *  attachment host, or a creature its controller controls. The last reads the
 *  creature type off the live view and fails CLOSED on a permanent the view
 *  does not carry. */
function targetedPermanentInScope(
    event: BecameTargetEvent,
    self: PermanentView,
    state: TriggerStateView | undefined,
    scope: BecameTargetTriggerArgs["scope"]
): boolean {
    if (scope === "yours") {
        if (event.targetControllerId !== self.controllerId) return false;
        const permanent = findPermanentInView(state, event.target.id);
        return permanent?.types.includes("Creature") === true;
    }
    const watched = scope === "host" ? self.attachedTo : self.id;
    return watched !== undefined && event.target.id === watched;
}
