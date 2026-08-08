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
    const { viewerId, state, dispatch } = runtime;
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
        // Manual-mode QA round 3, item 4 — the − / + buttons. The wheel and
        // the typed total shipped with the swap; neither exists on touch, and
        // a wheel gesture advertises itself to nobody.
        onLifeStep: (delta) =>
            dispatch.adjustLife({ playerId: player.id, delta }),
        // Manual-mode QA round 3, item 3 — "Reveal hand" had no surface at
        // all. The nameplate is where a table action ABOUT a player belongs
        // (the card verbs are about a card), so it is the menu's home.
        menuActions: [
            {
                key: "reveal-hand",
                label: "Reveal hand",
                onSelect: () =>
                    dispatch.revealHand({
                        playerId: player.id,
                        toPlayerIds: state.players
                            .filter((p) => p.id !== player.id)
                            .map((p) => p.id),
                    }),
            },
        ],
    });
}
