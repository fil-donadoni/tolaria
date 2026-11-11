// Priority frame (issue #9160): the lit half follows WHO MUST ACT
// (`computeActingSeat` → `computePriorityState`), never the active player.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));
vi.mock("~/hooks/useGameContext", () => ({ useGameContext: () => h.ctx }));
import PriorityIndicator from "../priority-indicator";
import TurnChangeSweep from "../turn-change-sweep";

const base = {
    playerId: "me",
    activePlayerId: "me",
    priorityPlayerId: "me",
    phase: "PRECOMBAT_MAIN",
};

beforeEach(() => {
    cleanup();
    h.ctx = { ...base };
});

describe("PriorityIndicator split edge (#9160)", () => {
    it("opponent's turn + MY priority lights MY half only", () => {
        h.ctx = { ...base, activePlayerId: "opp", priorityPlayerId: "me" };
        render(<PriorityIndicator />);
        expect(screen.queryByTestId("priority-half-mine")).not.toBeNull();
        expect(screen.queryByTestId("priority-half-opponent")).toBeNull();
    });

    it("my turn + OPPONENT's priority lights the opponent half only", () => {
        h.ctx = { ...base, activePlayerId: "me", priorityPlayerId: "opp" };
        render(<PriorityIndicator />);
        expect(screen.queryByTestId("priority-half-opponent")).not.toBeNull();
        expect(screen.queryByTestId("priority-half-mine")).toBeNull();
    });

    it("a pending choice lights the chooser's half", () => {
        h.ctx = {
            ...base,
            priorityPlayerId: "me",
            pendingChoices: [{ playerId: "opp" }],
        };
        render(<PriorityIndicator />);
        expect(screen.queryByTestId("priority-half-opponent")).not.toBeNull();
        expect(screen.queryByTestId("priority-half-mine")).toBeNull();
    });

    it("renders nothing when the game is over", () => {
        h.ctx = { ...base, gameOver: { winnerId: "me" } };
        render(<PriorityIndicator />);
        expect(screen.queryByTestId("priority-indicator")).toBeNull();
    });
});

describe("TurnChangeSweep (#9160)", () => {
    it("stays silent on mount, announces once the active player changes", () => {
        const { rerender } = render(<TurnChangeSweep />);
        expect(screen.queryByTestId("turn-change-sweep")).toBeNull();
        h.ctx = { ...base, activePlayerId: "opp" };
        rerender(<TurnChangeSweep />);
        const sweep = screen.getByTestId("turn-change-sweep");
        expect(sweep.getAttribute("data-turn-owner")).toBe("opponent");
    });
});
