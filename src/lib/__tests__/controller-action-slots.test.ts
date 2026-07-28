// Portrait bottom bar, variant D (#1759). The bar's promise is ZERO layout
// shift: one fixed-size primary slot, an always-mounted Pass-Turn button, and
// side pills for the remainder. All of that is decided by the pure slot
// assignment tested here, so the React surface only renders what it is handed.
import { describe, expect, it } from "vitest";
import type { ControllerAction } from "~/hooks/useControllerActions";
import {
    selectCommandSlots,
    splitControllerActions,
} from "~/lib/controller-action-slots";

function action(
    key: string,
    overrides: Partial<ControllerAction> = {}
): ControllerAction {
    return {
        key,
        label: key,
        tone: "primary",
        onClick: () => {},
        disabled: false,
        ...overrides,
    };
}

describe("splitControllerActions", () => {
    it("pulls Pass and Pass Turn out of the contextual list", () => {
        const pass = action("pass");
        const passTurn = action("pass-turn");
        const confirm = action("confirm-attackers");
        const split = splitControllerActions([confirm, pass, passTurn]);

        expect(split.pass).toBe(pass);
        expect(split.passTurn).toBe(passTurn);
        expect(split.contextual).toEqual([confirm]);
    });

    it("matches the suffixed pass-turn keys the engine emits", () => {
        const queued = action("pass-turn-cancel");
        expect(splitControllerActions([queued]).passTurn).toBe(queued);
        expect(splitControllerActions([queued]).contextual).toEqual([]);
    });

    it("returns undefined slots (never throws) when the engine offers nothing", () => {
        const split = splitControllerActions([]);
        expect(split.pass).toBeUndefined();
        expect(split.passTurn).toBeUndefined();
        expect(split.contextual).toEqual([]);
    });
});

describe("selectCommandSlots — the morphing primary (#1759)", () => {
    it("falls back to Pass when there is no contextual action", () => {
        const pass = action("pass", { label: "Pass" });
        const slots = selectCommandSlots([pass, action("pass-turn")]);

        expect(slots.primary).toBe(pass);
        expect(slots.statusPill).toBeUndefined();
        expect(slots.secondary).toEqual([]);
    });

    it("the first actionable contextual action BEATS Pass", () => {
        const confirm = action("confirm-attackers", {
            label: "Confirm Attackers",
        });
        const pass = action("pass", { label: "Pass" });
        const slots = selectCommandSlots([confirm, pass]);

        expect(slots.primary).toBe(confirm);
        // Pass is not demoted to a side pill — it keeps its own slot handling.
        expect(slots.secondary).toEqual([]);
    });

    it("remaining actionable contextual actions become side pills", () => {
        const confirm = action("confirm-attackers");
        const cancel = action("cancel-cast", { tone: "destructive" });
        const slots = selectCommandSlots([confirm, cancel, action("pass")]);

        expect(slots.primary).toBe(confirm);
        expect(slots.secondary).toEqual([cancel]);
    });

    it("a status pill takes the centre slot only when nothing is actionable", () => {
        const waiting = action("waiting", {
            label: "Waiting on opponent",
            pill: true,
            disabled: true,
        });
        const slots = selectCommandSlots([waiting]);

        expect(slots.primary).toBeUndefined();
        expect(slots.statusPill).toBe(waiting);
        expect(slots.secondary).toEqual([]);
    });

    it("keeps a status pill reachable as a side pill when it loses the centre slot", () => {
        // "Pass Turn queued (cancel)" can be raised while the player still
        // holds priority: Pass owns the centre slot, so the queued-turn pill
        // must survive as a side pill or the player cannot cancel it.
        const pass = action("pass", { label: "Pass" });
        const queued = action("queued-end-turn", {
            label: "Pass Turn queued (cancel)",
            tone: "destructive",
            pill: true,
        });
        const slots = selectCommandSlots([pass, action("pass-turn"), queued]);

        expect(slots.primary).toBe(pass);
        expect(slots.statusPill).toBe(queued);
        expect(slots.secondary).toEqual([queued]);
    });

    it("does not duplicate the status pill into the side pills when it holds the centre slot", () => {
        const autoPass = action("auto-pass", {
            label: "Auto-passing... (cancel)",
            tone: "destructive",
            pill: true,
        });
        const slots = selectCommandSlots([autoPass]);

        expect(slots.primary).toBeUndefined();
        expect(slots.statusPill).toBe(autoPass);
        expect(slots.secondary).toEqual([]);
    });

    it("keeps Pass Turn addressable in its own slot, even when disabled", () => {
        const passTurn = action("pass-turn", {
            label: "Pass Turn",
            disabled: true,
        });
        const slots = selectCommandSlots([action("pass"), passTurn]);
        expect(slots.passTurn).toBe(passTurn);
    });
});
