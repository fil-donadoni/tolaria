// Manual controller descriptors (PRD #2162, issues #2169/#2172) — the value
// injected into the seam `controllerActionsContext` (#2167) opened.
//
// The GRE controller's set is priority-shaped: Pass, Attack all, End turn,
// auto-pass, the Space/Enter hotkeys. A Manual Game enforces no turn structure
// (ADR 0080), so NONE of those belong: the descriptor set below is deliberately
// the six manual verbs (seven in a solo game, with Switch seat — issue #2173)
// and nothing else, and `manual-controller-actions.test` pins that
// "nothing else" as data.
//
// `cue` is fixed at "mine": with no priority to wait on, the pod would
// otherwise cue the player to wait for an opponent who is never asked.
//
// Not a React hook: it calls none, so each controller layout invoking it
// unconditionally is trivially rules-of-hooks safe.

import type { ControllerActionsSource } from "~/hooks/controllerActionsContext";
import type { ControllerAction } from "~/hooks/useControllerActions";
import type { ManualRuntime } from "./manual-runtime";
import { BOARD_ANCHOR_SELECTOR, findManualAnchor } from "./manual-verb-anchor";

/** Descriptor keys the manual controller offers in a TWO-PLAYER Manual Game,
 *  in display order. Exported so the guard test asserts the set rather than
 *  re-deriving it. */
export const MANUAL_CONTROLLER_KEYS = [
    "manual-end-turn",
    "manual-untap-all",
    "manual-draw",
    "manual-shuffle",
    "manual-concede",
    "manual-open-log",
] as const;

/** The solo-only 7th descriptor (issue #2173) — spliced in between Concede
 *  and Log only when {@link ManualLogControls.onSwitchSeat} is supplied.
 *  Exported so tests compose the solo key list without re-deriving the
 *  splice position. */
export const MANUAL_SWITCH_SEAT_KEY = "manual-switch-seat" as const;

/** The two things this descriptor set needs that aren't already on
 *  {@link ManualRuntime}: opening the log is a pure VIEW toggle
 *  (`manual-board-view.tsx`'s `logOpen` state), not a server verb, so it has
 *  no place on `ManualDispatch` alongside the real `manual*` mutations —
 *  bundling it there would let a descriptor dispatch a "mutation" with no
 *  `gameStates` row behind it. Switching the steered seat (issue #2173) is
 *  the same shape: the steered seat is client-local state in
 *  `manual-board-container.tsx`, not a server verb.
 *
 *  `onSwitchSeat` is present ONLY in a solo Manual Game — the container
 *  supplies it iff `solo`, never derived from player count here. In a
 *  two-player Manual Game the viewer's own seat is fixed and there is no
 *  "other seat" for this client to steer, so the descriptor must be ABSENT,
 *  not merely disabled (a disabled button still says "you could, but not
 *  now" — wrong message for "this isn't yours to switch"). */
export type ManualLogControls = {
    onOpenLog: () => void;
    onSwitchSeat?: () => void;
};

export function makeManualControllerActions(
    runtime: ManualRuntime,
    log: ManualLogControls
): ControllerActionsSource {
    const { viewerId, dispatch, requestVerbInput } = runtime;
    const actions: ControllerAction[] = [
        {
            key: "manual-end-turn",
            label: "End Turn",
            tone: "primary",
            disabled: false,
            onClick: () => dispatch.endTurn({ playerId: viewerId }),
        },
        {
            key: "manual-untap-all",
            label: "Untap all",
            tone: "primary",
            disabled: false,
            // The hand-written board bound this to `U`; the shared controller
            // already reserves that shortcut for its own untap-ish action, so
            // it is kept here as the same hotkey on a board where nothing else
            // claims it.
            shortcut: "U",
            onClick: () => dispatch.untapAll({ playerId: viewerId }),
        },
        {
            key: "manual-draw",
            label: "Draw",
            tone: "primary",
            disabled: false,
            onClick: () => dispatch.draw({ playerId: viewerId, n: 1 }),
        },
        {
            key: "manual-shuffle",
            label: "Shuffle",
            tone: "primary",
            disabled: false,
            onClick: () => dispatch.shuffle({ playerId: viewerId }),
        },
        {
            key: "manual-concede",
            label: "Concede",
            tone: "destructive",
            disabled: false,
            // Issue #2170 — the confirm popover has no single card/pile to
            // anchor to (Concede acts on the whole game), so it anchors to
            // the board root instead of a native `window.confirm`.
            onClick: () =>
                requestVerbInput(findManualAnchor(BOARD_ANCHOR_SELECTOR), {
                    kind: "confirm",
                    title: "Concede this game?",
                    onConfirm: () => dispatch.concede({ playerId: viewerId }),
                }),
        },
        ...(log.onSwitchSeat
            ? [
                  {
                      key: MANUAL_SWITCH_SEAT_KEY,
                      label: "Switch seat",
                      tone: "primary" as const,
                      disabled: false,
                      // Display-only on the GRE controller path
                      // (`useControllerActions` never mounts here) — the
                      // real keydown binding is `useManualSeatSwitchHotkey`,
                      // scoped to the manual board only when this callback
                      // exists.
                      shortcut: "S" as const,
                      onClick: log.onSwitchSeat,
                  },
              ]
            : []),
        {
            // Issue #2172 — the log used to be a permanently docked rail
            // (desktop) or a bare button behind a full-screen overlay
            // (portrait). It is now a collapsed surface, opened from here
            // like every other manual verb, and closed by the surface's own
            // Close button / Escape / backdrop tap
            // (`manual-log-surface.tsx`).
            key: "manual-open-log",
            label: "Log",
            tone: "primary",
            disabled: false,
            onClick: log.onOpenLog,
        },
    ];
    return () => ({
        cue: "mine",
        actions,
        isAutoPass: false,
        isQueuedEndTurn: false,
        attackAllConfirm: {
            open: false,
            eligibleCount: 0,
            confirm: () => {},
            cancel: () => {},
        },
    });
}
