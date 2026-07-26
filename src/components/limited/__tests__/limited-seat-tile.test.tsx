// Seat tile deck-ready state (issue #1580). Built on the real projection
// (`projectLimitedEvent`) so the view shape matches what the client actually
// receives, per the Frontend wiring rule (`.claude/rules/gre-development.md`)
// — a hand-built `LimitedEventSeatView` would mask a dropped/misrouted
// `hasDeck` field.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import type { LimitedEventSeatView } from "~/hooks/useLimitedEvent";
import LimitedSeatTile from "../limited-seat-tile";

afterEach(() => cleanup());

function eventRow(): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "sealed",
        status: "started",
        seatCount: 2,
        packSlots: ["lea"],
        seats: [
            { seatIndex: 0, userId: "user1", nickname: "Alice", pool: [] },
            { seatIndex: 1, isBot: true, nickname: "Bot Drafter", pool: [] },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

function seatsFor(hasDeckBySeat: Set<number>): LimitedEventSeatView[] {
    return projectLimitedEvent(
        eventRow(),
        "user1",
        false,
        hasDeckBySeat.size,
        new Map(),
        hasDeckBySeat
    ).seats as unknown as LimitedEventSeatView[];
}

describe("LimitedSeatTile — deck-ready badge (issue #1580)", () => {
    it("shows no Ready badge when the seat has no deck yet", () => {
        const [alice] = seatsFor(new Set());
        const { queryByText } = render(<LimitedSeatTile seat={alice} />);
        expect(queryByText("Ready")).toBeNull();
    });

    it("shows a Ready badge for a human seat once its deck is built", () => {
        const [alice] = seatsFor(new Set([0]));
        const { getByText } = render(<LimitedSeatTile seat={alice} />);
        expect(getByText("Ready")).toBeTruthy();
    });

    it("shows a Ready badge for a bot seat once its deck is Auto-Built", () => {
        const [, bot] = seatsFor(new Set([1]));
        const { getByText } = render(<LimitedSeatTile seat={bot} />);
        expect(getByText("Ready")).toBeTruthy();
    });

    it("never renders deck contents alongside the badge — pool/humanDeck stay whatever the projection gated them to", () => {
        const [, bot] = seatsFor(new Set([1]));
        // Non-viewer, non-completed seat: projection strips pool/humanDeck.
        expect(bot.pool).toBeNull();
        expect(bot.humanDeck).toBeNull();
        const { getByText } = render(<LimitedSeatTile seat={bot} />);
        expect(getByText("Ready")).toBeTruthy();
    });
});
