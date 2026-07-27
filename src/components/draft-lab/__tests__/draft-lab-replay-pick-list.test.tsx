// The historical-vs-recomputed side-by-side rendering (issue #1613 mandatory
// component coverage: "component tests for the side-by-side and the
// divergence marker"). Asserts both columns render, a diverged pick is
// visually distinguished, and — critically — nothing past the divergence
// point is DROPPED from the list (ADR 0074: never silently stop rendering).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import DraftLabReplayPickList from "../draft-lab-replay-pick-list";
import type {
    ReplayPickEntry,
    ReplayResult,
} from "@/lib/limited/draftReplayEngine";
import type { LimitedEventSeatView } from "@/hooks/useLimitedEvent";

afterEach(cleanup);

const pack: ReplayPickEntry["pack"] = [
    {
        scryfallId: "s-a",
        cardId: "card-a",
        cardName: "Card Alpha",
        pickId: "p1",
    },
    {
        scryfallId: "s-b",
        cardId: "card-b",
        cardName: "Card Beta",
        pickId: "p2",
    },
    {
        scryfallId: "s-c",
        cardId: "card-c",
        cardName: "Card Gamma",
        pickId: "p3",
    },
];

const seats = [
    { seatIndex: 0, nickname: "Bot 1" },
    { seatIndex: 1, nickname: "Bot 2" },
] as unknown as LimitedEventSeatView[];

describe("DraftLabReplayPickList (issue #1613)", () => {
    it("renders the historical pick beside the recomputed pick for a bot seat", () => {
        const result: ReplayResult = {
            picks: [
                {
                    pickIndex: 1,
                    seatIndex: 0,
                    seatPickNumber: 1,
                    isBot: true,
                    pack,
                    historicalCardId: "card-a",
                    recomputedCardId: "card-a",
                    diverged: false,
                },
            ],
            firstDivergedPickIndex: null,
            complete: true,
            stopReason: null,
            stoppedAtSeat: null,
        };
        render(<DraftLabReplayPickList result={result} seats={seats} />);
        expect(screen.getByText("Bot 1")).not.toBeNull();
        expect(screen.getAllByText("Card Alpha").length).toBe(2);
    });

    it("shows an em dash for a human seat's recomputed column — no fabricated comparison", () => {
        const result: ReplayResult = {
            picks: [
                {
                    pickIndex: 1,
                    seatIndex: 0,
                    seatPickNumber: 1,
                    isBot: false,
                    pack,
                    historicalCardId: "card-a",
                    recomputedCardId: null,
                    diverged: false,
                },
            ],
            firstDivergedPickIndex: null,
            complete: true,
            stopReason: null,
            stoppedAtSeat: null,
        };
        render(<DraftLabReplayPickList result={result} seats={seats} />);
        expect(screen.getByText("Card Alpha")).not.toBeNull();
        expect(screen.getByText("—")).not.toBeNull();
    });

    it("marks a diverged pick and keeps every later pick visible (never hidden past the divergence point)", () => {
        const result: ReplayResult = {
            picks: [
                {
                    pickIndex: 1,
                    seatIndex: 0,
                    seatPickNumber: 1,
                    isBot: true,
                    pack,
                    historicalCardId: "card-a",
                    recomputedCardId: "card-a",
                    diverged: false,
                },
                {
                    pickIndex: 2,
                    seatIndex: 1,
                    seatPickNumber: 1,
                    isBot: true,
                    pack,
                    historicalCardId: "card-b",
                    recomputedCardId: "card-c",
                    diverged: true,
                },
                {
                    pickIndex: 3,
                    seatIndex: 0,
                    seatPickNumber: 2,
                    isBot: true,
                    pack,
                    historicalCardId: "card-c",
                    recomputedCardId: "card-b",
                    diverged: false,
                },
            ],
            firstDivergedPickIndex: 2,
            complete: true,
            stopReason: null,
            stoppedAtSeat: null,
        };
        const { container } = render(
            <DraftLabReplayPickList result={result} seats={seats} />
        );
        // All three picks still render — none silently dropped past pick 2.
        expect(screen.getByText("#1")).not.toBeNull();
        expect(screen.getByText("#2")).not.toBeNull();
        expect(screen.getByText("#3")).not.toBeNull();
        expect(screen.getByText(/moved/)).not.toBeNull();

        // Pick #3 comes AFTER the divergence point (>= firstDivergedPickIndex)
        // and must be visually de-emphasised, not removed.
        const rows = container.querySelectorAll("li");
        expect(rows.length).toBe(3);
        expect(rows[2].className).toContain("opacity-70");
        // Pick #1 (before divergence) is not de-emphasised.
        expect(rows[0].className).not.toContain("opacity-70");
    });
});
