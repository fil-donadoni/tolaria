// The per-player Match Clock badge on the nameplate (issue #2308), and the
// Limited round countdown on the viewer's nameplate. Both read GameContext as
// board.tsx threads it (`matchClock` from the Game's `gameTicks` row,
// `roundDeadlineAt` from its `games` row); the data path that fills those rows
// is driven end-to-end in `convex/__tests__/matchClock.test.ts` and
// `limitedPairingMatch.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";
import type { TickClock } from "@convex/matchClock";
import { renderWithBoardContext } from "~/lib/testing/board-context";
import PlayerMatchClock from "../player-match-clock";
import ViewerRoundDeadline from "../viewer-round-deadline";

const T0 = 1_800_000_000_000;

const clock = (overrides: Partial<TickClock> = {}): TickClock => ({
    players: [
        { playerId: "me", remainingMs: 10 * 60_000 },
        { playerId: "opp", remainingMs: 61_000 },
    ],
    runningPlayerId: "opp",
    runningSince: T0,
    ...overrides,
});

function renderClocks(matchClock?: TickClock) {
    return renderWithBoardContext(
        <>
            <PlayerMatchClock playerId="me" />
            <PlayerMatchClock playerId="opp" compact />
        </>,
        { ctx: { playerId: "me", matchClock } }
    );
}

describe("PlayerMatchClock (issue #2308)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it("renders nothing for an unclocked Match", () => {
        renderClocks(undefined);
        expect(screen.queryByRole("timer")).toBeNull();
    });

    it("shows each player's remainder; only the running one ticks, against the local clock", () => {
        renderClocks(clock());
        const mine = screen.getByTestId("match-clock-me");
        const theirs = screen.getByTestId("match-clock-opp");
        expect(mine.textContent).toBe("10:00");
        expect(theirs.textContent).toBe("1:01");
        expect(theirs.dataset.running).toBe("true");
        expect(mine.dataset.running).toBeUndefined();

        act(() => {
            vi.advanceTimersByTime(3_000);
        });
        expect(theirs.textContent).toBe("0:58");
        expect(mine.textContent).toBe("10:00");
    });

    it("reads urgent under a minute and stops at 0:00 — it never acts on expiry", () => {
        renderClocks(clock());
        act(() => {
            vi.advanceTimersByTime(5_000);
        });
        const theirs = screen.getByTestId("match-clock-opp");
        expect(theirs.className).toContain("text-danger-strong");
        act(() => {
            vi.advanceTimersByTime(120_000);
        });
        expect(theirs.textContent).toBe("0:00");
    });
});

describe("ViewerRoundDeadline (issue #2308)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    it("shows the round countdown on the viewer's nameplate only", () => {
        renderWithBoardContext(
            <>
                <ViewerRoundDeadline playerId="me" />
                <ViewerRoundDeadline playerId="opp" />
            </>,
            { ctx: { playerId: "me", roundDeadlineAt: T0 + 30 * 60_000 } }
        );
        const timers = screen.getAllByRole("timer");
        expect(timers).toHaveLength(1);
        expect(timers[0].textContent).toBe("30m 0s left");
    });

    it("renders nothing outside a round pairing with a deadline", () => {
        renderWithBoardContext(<ViewerRoundDeadline playerId="me" />, {
            ctx: { playerId: "me" },
        });
        expect(screen.queryByRole("timer")).toBeNull();
    });

    it("at the deadline shows the event page's terminal wording and nothing else", () => {
        renderWithBoardContext(<ViewerRoundDeadline playerId="me" />, {
            ctx: { playerId: "me", roundDeadlineAt: T0 + 1_000 },
        });
        act(() => {
            vi.advanceTimersByTime(2_000);
        });
        expect(screen.getByRole("timer").textContent).toBe("Round closing…");
    });
});
