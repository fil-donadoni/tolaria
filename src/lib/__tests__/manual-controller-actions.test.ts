// Manual controller descriptor set (PRD #2162, issue #2169).
//
// The acceptance criterion has two halves and the NEGATIVE half is the one that
// rots silently: "offers the manual descriptor set AND offers no Pass Turn, no
// Attack all, no auto-pass toggle". A GRE action leaking into the manual
// controller would dispatch a mutation with no `gameStates` row behind it, and
// nothing else in this suite would notice. So the set is pinned as DATA, both
// ways round — no render, no DOM.
import { describe, expect, it, vi } from "vitest";
import {
    MANUAL_CONTROLLER_KEYS,
    MANUAL_SWITCH_SEAT_KEY,
    makeManualControllerActions,
} from "~/lib/manual-controller-actions";
import {
    manualRuntime,
    manualSeat,
    manualState,
    spyDispatch,
} from "./manual-test-fixtures";

function build(onSwitchSeat?: () => void) {
    const dispatch = spyDispatch();
    const state = manualState([manualSeat("me"), manualSeat("opp")]);
    const onOpenLog = vi.fn();
    const source = makeManualControllerActions(manualRuntime(state, dispatch), {
        onOpenLog,
        onSwitchSeat,
    });
    return { dispatch, onOpenLog, controller: source() };
}

describe("manual controller actions (#2169, #2172)", () => {
    it("offers exactly End Turn, Untap all, Draw, Shuffle, Concede and Log", () => {
        const { controller } = build();
        expect(controller.actions.map((a) => a.key)).toEqual([
            ...MANUAL_CONTROLLER_KEYS,
        ]);
        expect(controller.actions.map((a) => a.label)).toEqual([
            "End Turn",
            "Untap all",
            "Draw",
            "Shuffle",
            "Concede",
            "Log",
        ]);
    });

    it("dispatches the injected onOpenLog callback for the Log action, not a manual verb (#2172)", () => {
        const { controller, dispatch, onOpenLog } = build();
        const logAction = controller.actions.find(
            (a) => a.key === "manual-open-log"
        )!;
        logAction.onClick();
        expect(onOpenLog).toHaveBeenCalledTimes(1);
        // The log toggle is a pure view concern — it must never reach the
        // server dispatch the other five descriptors use.
        for (const fn of Object.values(dispatch)) {
            expect(fn).not.toHaveBeenCalled();
        }
    });

    it("offers NO Pass Turn, NO Attack all and NO auto-pass toggle", () => {
        const { controller } = build();
        const labels = controller.actions.map((a) => a.label.toLowerCase());
        expect(labels.some((l) => l.includes("pass"))).toBe(false);
        expect(labels.some((l) => l.includes("attack"))).toBe(false);
        expect(controller.isAutoPass).toBe(false);
        expect(controller.isQueuedEndTurn).toBe(false);
        // The Space-triggered "attack with everything" confirmation is the
        // other half of "no Attack all": it must never be able to open.
        expect(controller.attackAllConfirm.open).toBe(false);
        expect(controller.attackAllConfirm.eligibleCount).toBe(0);
    });

    it("each descriptor dispatches its own manual verb for the viewer's seat", () => {
        const { controller, dispatch } = build();
        const byKey = new Map(controller.actions.map((a) => [a.key, a]));

        byKey.get("manual-end-turn")!.onClick();
        expect(dispatch.endTurn).toHaveBeenCalledWith({ playerId: "me" });

        byKey.get("manual-untap-all")!.onClick();
        expect(dispatch.untapAll).toHaveBeenCalledWith({ playerId: "me" });

        byKey.get("manual-draw")!.onClick();
        expect(dispatch.draw).toHaveBeenCalledWith({ playerId: "me", n: 1 });

        byKey.get("manual-shuffle")!.onClick();
        expect(dispatch.shuffle).toHaveBeenCalledWith({ playerId: "me" });

        const confirm = vi
            .spyOn(window, "confirm")
            .mockImplementation(() => true);
        byKey.get("manual-concede")!.onClick();
        expect(dispatch.concede).toHaveBeenCalledWith({ playerId: "me" });
        confirm.mockRestore();
    });

    it("never cues the player to wait on an opponent who is never asked", () => {
        expect(build().controller.cue).toBe("mine");
    });

    // Issue #2173 — the descriptor is the client-solo gate, not player count:
    // `onSwitchSeat` is absent whenever the caller (the container, keyed off
    // `game.solo`) has no seat for this client to switch to.
    it("offers NO Switch seat descriptor when onSwitchSeat is not supplied (two-player)", () => {
        const { controller } = build();
        expect(
            controller.actions.some((a) => a.key === MANUAL_SWITCH_SEAT_KEY)
        ).toBe(false);
        expect(controller.actions.map((a) => a.key)).toEqual([
            ...MANUAL_CONTROLLER_KEYS,
        ]);
    });

    it("offers Switch seat, with an S hotkey hint, between Concede and Log when onSwitchSeat is supplied (solo)", () => {
        const onSwitchSeat = vi.fn();
        const { controller } = build(onSwitchSeat);
        const keys = controller.actions.map((a) => a.key);
        expect(keys).toEqual([
            "manual-end-turn",
            "manual-untap-all",
            "manual-draw",
            "manual-shuffle",
            "manual-concede",
            MANUAL_SWITCH_SEAT_KEY,
            "manual-open-log",
        ]);
        const switchSeatAction = controller.actions.find(
            (a) => a.key === MANUAL_SWITCH_SEAT_KEY
        )!;
        expect(switchSeatAction.label).toBe("Switch seat");
        expect(switchSeatAction.shortcut).toBe("S");

        switchSeatAction.onClick();
        expect(onSwitchSeat).toHaveBeenCalledTimes(1);
    });
});
