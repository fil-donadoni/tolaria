// Winner banner tests (PRD #1628 story 40, issue #1646). Drives
// `LimitedEventWinnerBanner` through the `event` prop shape the WIRE-FORMAT
// query (`getLimitedEvent`) actually returns — `event.standings` is exactly
// `projectLimitedEvent`'s output (`convex/limited/eventProjection.ts`), never
// a hand-built row (mirrors `limited-standings-table.test.tsx`'s discipline).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventWinnerBanner from "../limited-event-winner-banner";

afterEach(() => {
    cleanup();
});

function zeroRow(seatIndex: number): LimitedEventView["standings"][number] {
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

describe("LimitedEventWinnerBanner (issue #1646)", () => {
    it("renders nothing while the event's rounds are still running", () => {
        const event = makeEvent(
            {
                status: "playing",
                standings: [{ ...zeroRow(0), points: 6 }, zeroRow(1)],
            },
            [{ nickname: "Alice" }, { nickname: "Bob", isBot: true }]
        );
        const { container } = render(
            <LimitedEventWinnerBanner event={event} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders nothing before the play phase (open/started, zero standings rows)", () => {
        const event = makeEvent({ status: "open", standings: [] }, []);
        const { container } = render(
            <LimitedEventWinnerBanner event={event} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("names the TOP standings row once the event has concluded — never re-sorted client-side", () => {
        const event = makeEvent(
            {
                status: "finished",
                standings: [
                    {
                        ...zeroRow(1),
                        points: 9,
                        matchWins: 3,
                        matchLosses: 0,
                    },
                    { ...zeroRow(0), points: 3, matchWins: 1, matchLosses: 2 },
                ],
            },
            [
                { seatIndex: 0, nickname: "Alice" },
                { seatIndex: 1, nickname: "Bob" },
            ]
        );
        const { container } = render(
            <LimitedEventWinnerBanner event={event} />
        );
        expect(container.textContent).toContain("Bob");
        expect(container.textContent).not.toContain("won the event — 3 points");
        expect(container.textContent).toContain("9 points");
        expect(container.textContent).toContain("3-0");
    });

    it("falls back to a bot/seat label when the winning seat has no nickname", () => {
        const event = makeEvent(
            {
                status: "finished",
                standings: [{ ...zeroRow(0), points: 9, matchWins: 3 }],
            },
            [{ seatIndex: 0, isBot: true, nickname: undefined }]
        );
        const { container } = render(
            <LimitedEventWinnerBanner event={event} />
        );
        expect(container.textContent).toContain("Bot Drafter");
    });
});
