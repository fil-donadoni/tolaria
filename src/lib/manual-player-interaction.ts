// Manual player-nameplate interaction (PRD #2162, issue #2169) — the value
// injected into the seam `usePlayerInteractionContext` opened.
//
// Every GRE flag (targetable, damage-target pickable, divide stepper, priority
// ring) is false or zero: none of those concepts exist in a Manual Game. What
// IS present is the manual-only trio the shared nameplate wires only when
// offered — wheel to adjust, click to edit, Enter to commit an exact total —
// which is how the deleted `LifeBar`'s UX survives the swap without the board
// growing a second life widget.
//
// Not a React hook: it calls none, so `BoardPlayer` invoking it once per
// mounted seat is trivially rules-of-hooks safe.

import type { PlayerInteractionHook } from "~/hooks/usePlayerInteractionContext";
import type { ManualRuntime } from "./manual-runtime";

export function makeManualPlayerInteraction(
    runtime: ManualRuntime
): PlayerInteractionHook {
    const { viewerId, dispatch } = runtime;
    return (player) => ({
        isMe: player.id === viewerId,
        // A Manual Game has no priority (ADR 0080), so no seat ever wears the
        // priority ring.
        hasPriority: false,
        isTargetable: false,
        isDamageTargetPickable: false,
        isPlayerPicked: false,
        isDivideTarget: false,
        divideAssigned: 0,
        divideCanPlus: false,
        incDivide: () => {},
        decDivide: () => {},
        handleClick: () => {},
        // Either seat's life is adjustable: one player often runs both sides of
        // a manual game (solo testing is the mode's whole point, ADR 0080).
        lifeEditable: true,
        onLifeWheel: (deltaY) =>
            dispatch.adjustLife({
                playerId: player.id,
                delta: deltaY < 0 ? 1 : -1,
            }),
        onLifeCommit: (life) =>
            dispatch.adjustLife({
                playerId: player.id,
                delta: life - player.life,
            }),
    });
}
