import { describe, expect, it } from "vitest";
import {
    gestureReducer,
    INITIAL_GESTURE_STATE,
    MOUSE_DRAG_DISTANCE_PX,
    TOUCH_HOLD_MS,
    TOUCH_MOVE_TOLERANCE_PX,
    type GestureEffect,
    type GestureInput,
    type GestureState,
} from "../activation";

/** Feed a script of inputs through the real reducer, collecting every effect
 *  in order. The whole point of the decision core is that this needs no DOM,
 *  no timers and no component. */
function run(inputs: GestureInput[]): {
    state: GestureState;
    effects: GestureEffect[];
} {
    let state = INITIAL_GESTURE_STATE;
    const effects: GestureEffect[] = [];
    for (const input of inputs) {
        const step = gestureReducer(state, input);
        state = step.state;
        effects.push(...step.effects);
    }
    return { state, effects };
}

const touchPress = (x = 100, y = 100, t = 0): GestureInput => ({
    type: "press",
    key: "card-1",
    pointerId: 1,
    pointerKind: "touch",
    x,
    y,
    t,
});
const mousePress = (x = 100, y = 100, t = 0): GestureInput => ({
    type: "press",
    key: "card-1",
    pointerId: 1,
    pointerKind: "mouse",
    x,
    y,
    t,
});
const move = (x: number, y: number, t: number): GestureInput => ({
    type: "move",
    pointerId: 1,
    x,
    y,
    t,
});
const release = (x: number, y: number, t: number): GestureInput => ({
    type: "release",
    pointerId: 1,
    x,
    y,
    t,
});

const kinds = (effects: GestureEffect[]) => effects.map((e) => e.type);

describe("gesture activation core — thresholds (PRD #2405, issue #2583)", () => {
    it("touch hold of TOUCH_HOLD_MS with no movement starts a drag", () => {
        const { state, effects } = run([
            touchPress(100, 100, 0),
            { type: "hold", pointerId: 1, t: TOUCH_HOLD_MS },
        ]);
        expect(kinds(effects)).toEqual(["armHold", "dragStart"]);
        expect(effects[0]).toMatchObject({ delayMs: TOUCH_HOLD_MS });
        expect(effects[1]).toMatchObject({
            key: "card-1",
            reason: "hold",
            // The drag starts at the PRESS origin, not at a jittered finger.
            x: 100,
            y: 100,
        });
        expect(state.phase).toBe("dragging");
    });

    it("a 12px move at 100ms is a SCROLL, never a drag (AC: 12px @ 100ms)", () => {
        const { state, effects } = run([
            touchPress(100, 100, 0),
            move(112, 100, 100),
            // The timer would have fired at 250ms; it was cancelled at 100ms.
            { type: "hold", pointerId: 1, t: TOUCH_HOLD_MS },
            release(112, 100, 400),
        ]);
        expect(kinds(effects)).toEqual(["armHold", "cancelHold", "scroll"]);
        expect(effects).not.toContainEqual(
            expect.objectContaining({ type: "dragStart" })
        );
        // Releasing after a scroll is NOT a tap — that would select a card the
        // user only swiped past.
        expect(effects).not.toContainEqual(
            expect.objectContaining({ type: "tap" })
        );
        expect(state.phase).toBe("idle");
    });

    it("a move exactly AT the tolerance still allows the drag", () => {
        const { effects } = run([
            touchPress(100, 100, 0),
            move(100 + TOUCH_MOVE_TOLERANCE_PX, 100, 100),
            { type: "hold", pointerId: 1, t: TOUCH_HOLD_MS },
        ]);
        expect(kinds(effects)).toEqual(["armHold", "dragStart"]);
    });

    it("one pixel past the tolerance scrolls", () => {
        const { effects } = run([
            touchPress(100, 100, 0),
            move(100 + TOUCH_MOVE_TOLERANCE_PX + 1, 100, 100),
        ]);
        expect(kinds(effects)).toEqual(["armHold", "cancelHold", "scroll"]);
    });

    it("release before the hold, without movement, is a tap", () => {
        const { state, effects } = run([
            touchPress(100, 100, 0),
            move(104, 103, 40),
            release(104, 103, 120),
        ]);
        expect(kinds(effects)).toEqual(["armHold", "cancelHold", "tap"]);
        expect(effects[2]).toMatchObject({ key: "card-1", heldMs: 120 });
        expect(state.phase).toBe("idle");
    });

    it("a mouse drags past MOUSE_DRAG_DISTANCE_PX and never waits for a hold", () => {
        const { state, effects } = run([
            mousePress(100, 100, 0),
            move(100 + MOUSE_DRAG_DISTANCE_PX + 1, 100, 5),
        ]);
        // No `armHold` at all — a mouse is decided purely by distance.
        expect(kinds(effects)).toEqual(["dragStart"]);
        expect(effects[0]).toMatchObject({ reason: "distance" });
        expect(state.phase).toBe("dragging");
    });

    it("a mouse move AT the distance is not yet a drag; releasing there is a tap", () => {
        const { effects } = run([
            mousePress(100, 100, 0),
            move(100 + MOUSE_DRAG_DISTANCE_PX, 100, 5),
            release(100 + MOUSE_DRAG_DISTANCE_PX, 100, 60),
        ]);
        expect(kinds(effects)).toEqual(["cancelHold", "tap"]);
    });

    it("a mouse hold input can never promote a pending mouse press", () => {
        const { state, effects } = run([
            mousePress(100, 100, 0),
            { type: "hold", pointerId: 1, t: TOUCH_HOLD_MS },
        ]);
        expect(effects).toEqual([]);
        expect(state.phase).toBe("pending");
    });
});

describe("gesture activation core — drag lifecycle", () => {
    it("moves report the live position and end reports the drop point", () => {
        const { state, effects } = run([
            touchPress(100, 100, 0),
            { type: "hold", pointerId: 1, t: 250 },
            move(140, 220, 300),
            release(140, 220, 350),
        ]);
        expect(kinds(effects)).toEqual([
            "armHold",
            "dragStart",
            "dragMove",
            "dragEnd",
        ]);
        expect(effects[2]).toMatchObject({ x: 140, y: 220 });
        expect(effects[3]).toMatchObject({
            key: "card-1",
            x: 140,
            y: 220,
            cancelled: false,
        });
        expect(state.phase).toBe("idle");
    });

    it("pointercancel mid-drag ends it as cancelled (no drop)", () => {
        const { effects } = run([
            touchPress(100, 100, 0),
            { type: "hold", pointerId: 1, t: 250 },
            move(140, 220, 300),
            { type: "abort", pointerId: 1 },
        ]);
        expect(effects.at(-1)).toMatchObject({
            type: "dragEnd",
            cancelled: true,
        });
    });

    it("pointercancel while pending cancels the timer and does not tap", () => {
        const { effects } = run([
            touchPress(100, 100, 0),
            { type: "abort", pointerId: 1 },
        ]);
        expect(kinds(effects)).toEqual(["armHold", "cancelHold"]);
    });

    it("a second finger cannot steer or hijack the first one's gesture", () => {
        const { state, effects } = run([
            touchPress(100, 100, 0),
            { type: "hold", pointerId: 1, t: 250 },
            // Second pointer: its move, its press and its release are all inert.
            { type: "move", pointerId: 2, x: 500, y: 500, t: 260 },
            {
                type: "press",
                key: "card-2",
                pointerId: 2,
                pointerKind: "touch",
                x: 500,
                y: 500,
                t: 270,
            },
            { type: "release", pointerId: 2, x: 500, y: 500, t: 280 },
            release(140, 220, 300),
        ]);
        expect(kinds(effects)).toEqual(["armHold", "dragStart", "dragEnd"]);
        expect(effects.at(-1)).toMatchObject({ key: "card-1", x: 140 });
        expect(state.phase).toBe("idle");
    });

    it("a hold timer that fires after the press already resolved is inert", () => {
        const { effects } = run([
            touchPress(100, 100, 0),
            release(100, 100, 100),
            { type: "hold", pointerId: 1, t: 250 },
        ]);
        expect(kinds(effects)).toEqual(["armHold", "cancelHold", "tap"]);
    });
});
