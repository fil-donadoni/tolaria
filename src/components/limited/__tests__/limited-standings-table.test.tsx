// Standings table tests (PRD #1628 stories 22-24, issue #1643). Drives
// `LimitedStandingsTable` through the `event` prop shape the WIRE-FORMAT
// query (`getLimitedEvent`) actually returns — `event.standings` is exactly
// `projectLimitedEvent`'s output (`convex/limited/eventProjection.ts`), never
// a hand-built `StandingsRow[]` (mirrors `limited-review-panel.test.tsx`'s
// discipline).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedStandingsTable from "../limited-standings-table";

afterEach(() => {
    cleanup();
});

function zeroRow(
    seatIndex: number
): LimitedEventView["standings"][number] {
    return {
        seatIndex,
        points: 0,
        matchWins: 0,
        matchLosses: 0,
        matchDraws: 0,
        gameWins: 0,
        gameLosses: 0,
        gameWinPct: 0,
        opponentMatchWinPct: 0,
    };
}

function makeEvent(
    overrides: Partial<LimitedEventView>,
    seatsOverride: Partial<LimitedEventView["seats"][number]>[]
): LimitedEventView {
    const base = {
        userId: undefined,
        nickname: undefined,
        isBot: false,
        isViewer: false,
        poolCount: null,
        pool: null,
        humanDeck: null,
        deckSummary: null,
        currentPack: null,
        packQueueCount: null,
        pickDeadline: null,
    };
    const seats = seatsOverride.map((s, i) => ({
        ...base,
        seatIndex: i,
        ...s,
    }));
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "playing",
        seatCount: seats.length,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        matchFormat: "bo3",
        rounds: [],
        standings: seats.map((s) => zeroRow(s.seatIndex)),
        completed: false,
        seatsWithDeck: 0,
        seats,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedStandingsTable (issue #1643)", () => {
    it("renders nothing when there are no standings rows at all (no seats)", () => {
        const event = makeEvent({ standings: [] }, []);
        const { container } = render(<LimitedStandingsTable event={event} />);
        expect(container.firstChild).toBeNull();
    });

    it("is readable — zeroed, not crashed or blank — for an event with no results yet", () => {
        const event = makeEvent({}, [
            { seatIndex: 0, userId: "user-1", nickname: "Alice" },
            { seatIndex: 1, isBot: true, nickname: "Bot 2" },
        ]);
        const { container } = render(<LimitedStandingsTable event={event} />);
        expect(container.textContent).toContain("Alice");
        expect(container.textContent).toContain("Bot 2");
        // Every zeroed field renders as a visible "0"/"0%", not blank.
        const rows = container.querySelectorAll(
            '[data-testid="standings-row"]'
        );
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.textContent).toContain("0-0");
            expect(row.textContent).toContain("0%");
        }
    });

    it("highlights the viewer's own seat", () => {
        const event = makeEvent(
            {
                standings: [
                    {
                        ...zeroRow(0),
                        points: 3,
                        matchWins: 1,
                        gameWins: 2,
                        gameWinPct: 1,
                    },
                    zeroRow(1),
                ],
            },
            [
                {
                    seatIndex: 0,
                    userId: "user-1",
                    nickname: "Alice",
                    isViewer: true,
                },
                { seatIndex: 1, isBot: true, nickname: "Bot 2" },
            ]
        );
        const { container } = render(<LimitedStandingsTable event={event} />);
        const viewerRow = container.querySelector(
            '[data-seat-index="0"]'
        )!;
        const otherRow = container.querySelector(
            '[data-seat-index="1"]'
        )!;
        expect(viewerRow.getAttribute("data-is-viewer")).toBe("true");
        expect(otherRow.getAttribute("data-is-viewer")).toBe("false");
        expect(viewerRow.className).toContain("bg-accent/5");
        expect(otherRow.className).not.toContain("bg-accent/5");
    });

    it("renders rows in the order the server sorted them (points desc), never re-sorting client-side", () => {
        const event = makeEvent(
            {
                standings: [
                    { ...zeroRow(1), points: 6 },
                    { ...zeroRow(0), points: 3 },
                    { ...zeroRow(2), points: 0 },
                ],
            },
            [
                { seatIndex: 0, nickname: "Alice" },
                { seatIndex: 1, nickname: "Bob" },
                { seatIndex: 2, nickname: "Carol" },
            ]
        );
        const { container } = render(<LimitedStandingsTable event={event} />);
        const rows = [
            ...container.querySelectorAll('[data-testid="standings-row"]'),
        ];
        expect(rows.map((r) => r.getAttribute("data-seat-index"))).toEqual([
            "1",
            "0",
            "2",
        ]);
    });
});
