// Review panel tests (PRD #1107 story 26, issue #1116): drives
// `LimitedReviewPanel` through the `event` prop shape the WIRE-FORMAT query
// (`getLimitedEvent`) actually returns — `completed`/`pool`/`humanDeck`/
// `autoBuiltDeck` per the server projection — so a dropped field on the
// server side would surface here too (mirrors `limited-vs-ai-panel.test.tsx`'s
// discipline: never a hand-built GameState-shaped view).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedReviewPanel from "../limited-review-panel";

afterEach(() => {
    cleanup();
});

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
        currentPack: null,
        packQueueCount: null,
        pickDeadline: null,
        autoBuiltDeck: null,
    };
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "started",
        seatCount: seatsOverride.length,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        completed: false,
        seatsWithDeck: 0,
        seats: seatsOverride.map((s, i) => ({
            ...base,
            seatIndex: i,
            ...s,
        })),
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedReviewPanel (issue #1116)", () => {
    it("renders nothing while the event is not completed", () => {
        const event = makeEvent({ completed: false, seatsWithDeck: 1 }, [
            { seatIndex: 0, userId: "user-1", isViewer: true, pool: [] },
            { seatIndex: 1, isBot: true },
        ]);
        const { container } = render(<LimitedReviewPanel event={event} />);
        expect(container.firstChild).toBeNull();
    });

    it("reveals every seat's Pool and Deck once completed, including a non-owned human seat's humanDeck", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 2 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false, // NOT the viewer — proves reveal isn't owner-gated
                pool: [
                    {
                        scryfallId: "s1",
                        cardId: "c1",
                        cardName: "Lightning Bolt",
                    },
                ],
                humanDeck: {
                    cards: [{ cardId: "c1", cardName: "Lightning Bolt" }],
                    sideboard: [],
                    colors: ["R"],
                },
            },
            {
                seatIndex: 1,
                isBot: true,
                nickname: "Bot 2",
                pool: [
                    { scryfallId: "s2", cardId: "c2", cardName: "Mountain" },
                ],
                autoBuiltDeck: {
                    cards: [{ cardId: "c2", cardName: "Mountain" }],
                    sideboard: [],
                    colors: ["R", "G"],
                },
            },
        ]);
        const { getByText, getAllByText, container } = render(
            <LimitedReviewPanel event={event} />
        );

        expect(getByText("Review the Table")).toBeTruthy();
        // Alice's (human) deck + pool are both visible, even though she is
        // NOT the current viewer's own seat.
        expect(getAllByText("Lightning Bolt").length).toBeGreaterThan(0);
        // The bot's Auto-Built deck + pool are visible too.
        expect(getAllByText("Mountain").length).toBeGreaterThan(0);
        expect(container.textContent).toContain("R/G");
    });

    it("numbers a DRAFT event's pool in pick order instead of grouping by count", () => {
        const event = makeEvent(
            { type: "draft", completed: true, seatsWithDeck: 1 },
            [
                {
                    seatIndex: 0,
                    userId: "user-1",
                    nickname: "Alice",
                    pool: [
                        {
                            scryfallId: "p1",
                            cardId: "p1",
                            cardName: "First Pick",
                        },
                        {
                            scryfallId: "p2",
                            cardId: "p2",
                            cardName: "Second Pick",
                        },
                    ],
                    humanDeck: null,
                },
            ]
        );
        const { getByText, container } = render(
            <LimitedReviewPanel event={event} />
        );
        expect(getByText("First Pick")).toBeTruthy();
        expect(getByText("Second Pick")).toBeTruthy();
        // Rendered as an ordered list (<ol>), not the grouped <ul> a Sealed
        // seat uses.
        expect(container.querySelector("ol")).not.toBeNull();
    });

    it("shows 'No deck submitted' for a human seat with no humanDeck", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 1 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                pool: [],
                humanDeck: null,
            },
        ]);
        const { getByText } = render(<LimitedReviewPanel event={event} />);
        expect(getByText("No deck submitted.")).toBeTruthy();
    });
});
