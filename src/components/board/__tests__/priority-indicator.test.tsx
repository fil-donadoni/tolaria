// Priority frame (issues #9160, #9295): the lit half follows WHO MUST ACT
// (`computeActingSeat` → `computePriorityState`), never the active player.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, act } from "@testing-library/react";

const h = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));
vi.mock("~/hooks/useGameContext", () => ({ useGameContext: () => h.ctx }));
import PriorityIndicator, {
    PRIORITY_CUE_DELAY_MS,
} from "../priority-indicator";
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

const lit = () => screen.queryByTestId("priority-half-mine");
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("PriorityIndicator split edge (#9160, #9295)", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("opponent's turn + MY priority lights MY half once the delay elapsed", () => {
        h.ctx = { ...base, activePlayerId: "opp", priorityPlayerId: "me" };
        render(<PriorityIndicator />);
        advance(PRIORITY_CUE_DELAY_MS);
        expect(lit()).not.toBeNull();
        expect(screen.queryByTestId("priority-half-opponent")).toBeNull();
    });

    it("my turn + OPPONENT's priority renders nothing", () => {
        h.ctx = { ...base, activePlayerId: "me", priorityPlayerId: "opp" };
        render(<PriorityIndicator />);
        advance(PRIORITY_CUE_DELAY_MS * 2);
        expect(screen.queryByTestId("priority-indicator")).toBeNull();
    });

    it("a pending choice owed by the opponent renders nothing", () => {
        h.ctx = {
            ...base,
            priorityPlayerId: "me",
            pendingChoices: [{ playerId: "opp" }],
        };
        render(<PriorityIndicator />);
        advance(PRIORITY_CUE_DELAY_MS * 2);
        expect(screen.queryByTestId("priority-indicator")).toBeNull();
    });

    it("renders nothing when the game is over", () => {
        h.ctx = { ...base, gameOver: { winnerId: "me" } };
        render(<PriorityIndicator />);
        advance(PRIORITY_CUE_DELAY_MS * 2);
        expect(screen.queryByTestId("priority-indicator")).toBeNull();
    });

    it("is dark at 4.9 s and lit at 5 s", () => {
        render(<PriorityIndicator />);
        advance(PRIORITY_CUE_DELAY_MS - 100);
        expect(lit()).toBeNull();
        advance(100);
        expect(lit()).not.toBeNull();
    });

    it("leaving `mine` before 5 s cancels; returning restarts from zero", () => {
        const { rerender } = render(<PriorityIndicator />);
        advance(4000);
        h.ctx = { ...base, priorityPlayerId: "opp" };
        rerender(<PriorityIndicator />);
        advance(2000);
        expect(lit()).toBeNull();
        h.ctx = { ...base };
        rerender(<PriorityIndicator />);
        advance(PRIORITY_CUE_DELAY_MS - 100);
        expect(lit()).toBeNull();
        advance(100);
        expect(lit()).not.toBeNull();
    });

    it("staying `mine` across priority -> pending choice keeps the elapsed time", () => {
        const { rerender } = render(<PriorityIndicator />);
        advance(3000);
        h.ctx = { ...base, pendingChoices: [{ playerId: "me" }] };
        rerender(<PriorityIndicator />);
        advance(2000);
        expect(lit()).not.toBeNull();
    });

    it("a solo viewing-seat switch restarts the countdown", () => {
        h.ctx = { ...base, playerId: "u-p1", priorityPlayerId: "u-p1" };
        const { rerender } = render(<PriorityIndicator />);
        advance(4000);
        h.ctx = { ...base, playerId: "u-p2", priorityPlayerId: "u-p2" };
        rerender(<PriorityIndicator />);
        advance(2000);
        expect(lit()).toBeNull();
        advance(3000);
        expect(lit()).not.toBeNull();
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
