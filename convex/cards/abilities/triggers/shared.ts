// Shared scope-resolution helpers consumed by the permanent-anchored trigger
// factories under `convex/cards/abilities/triggers/`. Centralizing the scope
// → playerId mapping keeps the per-factory `matches()` glue tiny and means a
// fix to scope semantics (e.g. broadening "host-controller" to follow control
// changes) lands in one place rather than once per factory.

import type {
    PermanentView,
    PhaseBeginEvent,
    TriggerStateView,
} from "../../types";

/** Who the trigger cares about — drives both the `matches()` filter and the
 *  `scopedPlayerId` passed to the per-card resolve body.
 *
 *  - `your` — fires only on the source's controller's turn (CR 603.6a "your
 *    upkeep"). scopedPlayerId = source.controllerId.
 *  - `each` — fires on every player's matching step (Karma, Copper Tablet,
 *    Power Surge, Howling Mine). scopedPlayerId = event.activePlayerId.
 *  - `opponents` — fires only on opponents' steps. scopedPlayerId =
 *    event.activePlayerId.
 *  - `host-controller` — Aura triggers anchored on the enchanted permanent's
 *    controller (Farmstead, Feedback, Cursed Land, Warp Artifact, Wanderlust,
 *    Paralyze, Power Leak). scopedPlayerId = host's current controller.
 *
 *  When a scope predicate fails the helper returns `null` so the caller can
 *  short-circuit `matches()`. */
export type TriggerScope = "your" | "each" | "opponents" | "host-controller";

/** Resolves a `TriggerScope` against the current PHASE_BEGIN event.
 *
 *  Returns the playerId the trigger is "about" (the active player whose step
 *  it is, or — for `host-controller` — the enchanted permanent's controller),
 *  or `null` if the scope predicate fails and the trigger should not fire.
 *
 *  The `state` argument is required for `host-controller` so the helper can
 *  walk every player's battlefield looking for `self.attachedTo`. The other
 *  scopes only read fields on `event` and `self`. */
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
