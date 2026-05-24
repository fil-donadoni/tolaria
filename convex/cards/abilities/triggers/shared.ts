// Shared helpers for permanent-anchored trigger factories
// (`diedTrigger`, `enteredTrigger`, `leftTrigger`, `tappedTrigger`). Each
// factory translates an event payload to an `{ instanceId, controllerId }`
// identity for the affected permanent and asks `matchesPermanentScope` to
// gate the trigger by source-relative scope (CR 109.2 / 109.4 / 603.2).
//
// The vocabulary (`self`/`yours`/`opponents`/`any`/`another-yours`/`any-other`)
// is fixed at ADR 0002 — keep this file as the single source of truth so the
// four factories stay in lockstep.

import type {
    PermanentView,
    PhaseBeginEvent,
    TriggerStateView,
} from "../../types";

/** Who the trigger cares about — drives both the `matches()` filter and the
 *  `scopedPlayerId` passed to the per-card resolve body. See
 *  `phaseTrigger.ts` for the per-scope contract. */
export type TriggerScope = "your" | "each" | "opponents" | "host-controller";

/** Resolves a `TriggerScope` against the current PHASE_BEGIN event.
 *  Returns the playerId the trigger is "about", or `null` if the scope
 *  predicate fails and the trigger should not fire. */
export function resolvePhaseScope(
    scope: TriggerScope,
    event: PhaseBeginEvent,
    self: PermanentView,
    state?: TriggerStateView
): string | null {
    if (scope === "each") return event.activePlayerId;
    if (scope === "your") {
        return event.activePlayerId === self.controllerId
            ? self.controllerId
            : null;
    }
    if (scope === "opponents") {
        return event.activePlayerId !== self.controllerId
            ? event.activePlayerId
            : null;
    }
    // host-controller (CR 303.4b — Aura trigger keyed on enchanted permanent).
    if (!self.attachedTo) return null;
    for (const p of state?.players ?? []) {
        const host = p.battlefield.find((c) => c.id === self.attachedTo);
        if (host) {
            return host.controllerId === event.activePlayerId
                ? host.controllerId
                : null;
        }
    }
    return null;
}

/** Source-relative scope vocabulary shared by permanent-anchored trigger
 *  factories. Mirrors the ADR 0002 scope axis for died/entered/left/tapped. */
export type PermanentScope =
    | "self"
    | "yours"
    | "opponents"
    | "any"
    | "another-yours"
    | "any-other";

/** Identifying fields lifted from an event payload — instance id of the
 *  affected permanent and its controller at event time (CR 603.10 last
 *  known information). Different events expose these under different field
 *  names (`creatureInstanceId`/`creatureControllerId`,
 *  `permanentId`/`controllerId`, etc.) — the caller normalizes once and
 *  hands this shape to the resolver. */
export interface ScopedPermanentIdentity {
    instanceId: string;
    controllerId: string;
}

/** Returns true if the scoped event's affected permanent satisfies `scope`
 *  relative to the trigger's source `self`. Pure — reads only its inputs.
 *  CR 109.2 (self-exclusion) is enforced for `another-yours` / `any-other`. */
export function matchesPermanentScope(
    scope: PermanentScope,
    event: ScopedPermanentIdentity,
    self: PermanentView
): boolean {
    switch (scope) {
        case "self":
            return event.instanceId === self.id;
        case "yours":
            return event.controllerId === self.controllerId;
        case "opponents":
            return event.controllerId !== self.controllerId;
        case "any":
            return true;
        case "another-yours":
            return (
                event.controllerId === self.controllerId &&
                event.instanceId !== self.id
            );
        case "any-other":
            return event.instanceId !== self.id;
    }
}
