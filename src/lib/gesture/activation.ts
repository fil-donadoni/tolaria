/** The gesture ACTIVATION decision core for every editing surface (PRD #2405,
 *  ADR 0101, gesture model **A** — the prototype's verdict).
 *
 *  This module is the SINGLE AUTHORITY on when a press becomes a drag, a
 *  scroll or a tap. It is deliberately pure — no DOM, no timers, no React —
 *  so the decision can be unit-tested directly instead of inferred from a
 *  rendered surface (happy-dom has no layout and cannot arbitrate a gesture).
 *
 *  Two consumers read the SAME constants, which is the point:
 *    - `useGestureEngine` (`./useGestureEngine.ts`) runs this reducer against
 *      real pointer events and owns the ghost / drop-target plumbing.
 *    - `useDeckDragSensors` (`~/components/deckbuilder/useDeckDragSensors`)
 *      configures dnd-kit's `PointerSensor` FROM these constants, so dnd-kit
 *      stays the drag transport on the surfaces that already use it while
 *      being physically unable to drift from the decision core. A drift guard
 *      (`useDeckDragSensors.test.ts`) asserts the sensor's configured values
 *      are these values.
 *
 *  Model A: touch pointerdown arms a {@link TOUCH_HOLD_MS} timer; moving more
 *  than {@link TOUCH_MOVE_TOLERANCE_PX} before it fires yields to native
 *  scrolling (timer cancelled, never a drag); the timer firing with the finger
 *  still down and still (nearly) still starts the drag; releasing without ever
 *  exceeding the tolerance is a tap (→ select → Peek Panel). A mouse never
 *  waits: it drags as soon as it passes {@link MOUSE_DRAG_DISTANCE_PX}.
 */

/** Touch hold before a press becomes a drag (model A). Also dnd-kit's
 *  `Delay.value`. */
export const TOUCH_HOLD_MS = 250;
/** Movement (px) during the hold that means "the user is scrolling, not
 *  dragging". Also dnd-kit's `Delay.tolerance`. */
export const TOUCH_MOVE_TOLERANCE_PX = 10;
/** Mouse movement (px) that starts a drag immediately — no hold. Also
 *  dnd-kit's `Distance.value`. */
export const MOUSE_DRAG_DISTANCE_PX = 8;

/** How long a POINTER single-click waits before its action runs, on a surface
 *  where the same element also has a double-click action AND the single-click
 *  action cannot be undone.
 *
 *  Not part of model A's reducer above (which arbitrates press → drag/scroll/
 *  tap, never click counts) — it lives here because it is the same kind of
 *  datum: one number deciding what a gesture MEANT, which must have exactly
 *  one home. A browser delivers a double-click as `click`(detail 1),
 *  `click`(detail 2), `dblclick`, so an element that acts on the first click
 *  has already performed a destructive action by the time the double-click
 *  arrives (PR #2641 review, blocker 1: a double-click on a deck tile removed
 *  TWO copies before the Inspect Overlay opened). 300ms covers a comfortable
 *  double-click without being felt as lag; the OS threshold is typically
 *  400–500ms, so a deliberately SLOW double-click can still let the single
 *  click through — the reason this delay is only paid where the single click
 *  is destructive, never on a tap that merely selects. */
export const DOUBLE_CLICK_WINDOW_MS = 300;

/** Pointer kinds the engine distinguishes. Pen behaves as touch: it is a
 *  direct-manipulation pointer on a scrolling surface, so it needs the same
 *  scroll/drag disambiguation a finger does. */
export type GesturePointerKind = "touch" | "mouse" | "pen";

/** `idle` nothing pressed · `pending` pressed, decision not yet made ·
 *  `scrolling` yielded to the browser · `dragging` the drag is live. */
export type GesturePhase = "idle" | "pending" | "scrolling" | "dragging";

export interface GestureState {
    readonly phase: GesturePhase;
    /** Item under the press (the surface's own key), null while idle. */
    readonly key: string | null;
    readonly pointerId: number | null;
    readonly pointerKind: GesturePointerKind | null;
    /** Press origin. */
    readonly x0: number;
    readonly y0: number;
    readonly t0: number;
    /** Latest pointer position. */
    readonly x: number;
    readonly y: number;
}

export const INITIAL_GESTURE_STATE: GestureState = {
    phase: "idle",
    key: null,
    pointerId: null,
    pointerKind: null,
    x0: 0,
    y0: 0,
    t0: 0,
    x: 0,
    y: 0,
};

export type GestureInput =
    | {
          type: "press";
          key: string;
          pointerId: number;
          pointerKind: GesturePointerKind;
          x: number;
          y: number;
          t: number;
      }
    | { type: "move"; pointerId: number; x: number; y: number; t: number }
    /** The {@link TOUCH_HOLD_MS} timer fired. */
    | { type: "hold"; pointerId: number; t: number }
    | { type: "release"; pointerId: number; x: number; y: number; t: number }
    /** `pointercancel` — the browser took the gesture, or the surface unmounted. */
    | { type: "abort"; pointerId: number };

export type GestureEffect =
    /** Start the hold timer; it must feed back a `hold` input for this
     *  `pointerId` after `delayMs`. */
    | { type: "armHold"; pointerId: number; delayMs: number }
    | { type: "cancelHold" }
    | {
          type: "dragStart";
          key: string;
          x: number;
          y: number;
          reason: "hold" | "distance";
      }
    | { type: "dragMove"; key: string; x: number; y: number }
    | {
          type: "dragEnd";
          key: string;
          x: number;
          y: number;
          cancelled: boolean;
      }
    /** The press resolved as a native scroll — the surface does nothing. */
    | { type: "scroll"; key: string }
    /** The press resolved as a tap — select the card / open the Peek Panel. */
    | { type: "tap"; key: string; heldMs: number };

export interface GestureTransition {
    readonly state: GestureState;
    readonly effects: readonly GestureEffect[];
}

function distance(state: GestureState, x: number, y: number): number {
    return Math.hypot(x - state.x0, y - state.y0);
}

function idle(): GestureState {
    return INITIAL_GESTURE_STATE;
}

/** Whether this input concerns the pointer the state is tracking. A second
 *  finger landing mid-gesture must never steer the first one's decision. */
function samePointer(state: GestureState, pointerId: number): boolean {
    return state.pointerId === pointerId;
}

/**
 * The decision core: `(state, input) → (state, effects)`. Pure and total —
 * every input is defined in every phase, and an input that does not apply
 * returns the state unchanged with no effects rather than throwing.
 */
export function gestureReducer(
    state: GestureState,
    input: GestureInput
): GestureTransition {
    switch (input.type) {
        case "press": {
            // A press arriving mid-drag (second finger) is ignored: the live
            // drag owns the gesture until it ends.
            if (state.phase === "dragging") return { state, effects: [] };
            const next: GestureState = {
                phase: "pending",
                key: input.key,
                pointerId: input.pointerId,
                pointerKind: input.pointerKind,
                x0: input.x,
                y0: input.y,
                t0: input.t,
                x: input.x,
                y: input.y,
            };
            // A mouse never waits — it is decided purely by distance.
            return {
                state: next,
                effects:
                    input.pointerKind === "mouse"
                        ? []
                        : [
                              {
                                  type: "armHold",
                                  pointerId: input.pointerId,
                                  delayMs: TOUCH_HOLD_MS,
                              },
                          ],
            };
        }
        case "move": {
            if (!samePointer(state, input.pointerId))
                return { state, effects: [] };
            const moved: GestureState = { ...state, x: input.x, y: input.y };
            if (state.phase === "dragging") {
                return {
                    state: moved,
                    effects: [
                        {
                            type: "dragMove",
                            key: state.key as string,
                            x: input.x,
                            y: input.y,
                        },
                    ],
                };
            }
            if (state.phase !== "pending") return { state: moved, effects: [] };
            const dist = distance(state, input.x, input.y);
            if (state.pointerKind === "mouse") {
                if (dist > MOUSE_DRAG_DISTANCE_PX) {
                    return {
                        state: { ...moved, phase: "dragging" },
                        effects: [
                            {
                                type: "dragStart",
                                key: state.key as string,
                                x: input.x,
                                y: input.y,
                                reason: "distance",
                            },
                        ],
                    };
                }
                return { state: moved, effects: [] };
            }
            if (dist > TOUCH_MOVE_TOLERANCE_PX) {
                // The finger is scrolling. Cancel the hold timer and get out
                // of the browser's way — this press can no longer become a
                // drag OR a tap, however long it is held afterwards.
                return {
                    state: { ...moved, phase: "scrolling" },
                    effects: [
                        { type: "cancelHold" },
                        { type: "scroll", key: state.key as string },
                    ],
                };
            }
            return { state: moved, effects: [] };
        }
        case "hold": {
            // Only a still-pending touch press can be promoted by the timer. A
            // late timer for a press that already scrolled/released is inert.
            if (
                !samePointer(state, input.pointerId) ||
                state.phase !== "pending"
            )
                return { state, effects: [] };
            if (state.pointerKind === "mouse") return { state, effects: [] };
            return {
                state: { ...state, phase: "dragging" },
                effects: [
                    {
                        type: "dragStart",
                        key: state.key as string,
                        // The drag starts where the finger went DOWN, not
                        // wherever a sub-tolerance jitter left it.
                        x: state.x0,
                        y: state.y0,
                        reason: "hold",
                    },
                ],
            };
        }
        case "release": {
            if (!samePointer(state, input.pointerId))
                return { state, effects: [] };
            if (state.phase === "dragging") {
                return {
                    state: idle(),
                    effects: [
                        {
                            type: "dragEnd",
                            key: state.key as string,
                            x: input.x,
                            y: input.y,
                            cancelled: false,
                        },
                    ],
                };
            }
            if (state.phase === "pending") {
                return {
                    state: idle(),
                    effects: [
                        { type: "cancelHold" },
                        {
                            type: "tap",
                            key: state.key as string,
                            heldMs: input.t - state.t0,
                        },
                    ],
                };
            }
            // `scrolling` — the browser handled it; releasing is not a tap.
            return { state: idle(), effects: [] };
        }
        case "abort": {
            if (!samePointer(state, input.pointerId))
                return { state, effects: [] };
            if (state.phase === "dragging") {
                return {
                    state: idle(),
                    effects: [
                        {
                            type: "dragEnd",
                            key: state.key as string,
                            x: state.x,
                            y: state.y,
                            cancelled: true,
                        },
                    ],
                };
            }
            return {
                state: idle(),
                effects:
                    state.phase === "pending" ? [{ type: "cancelHold" }] : [],
            };
        }
    }
}
