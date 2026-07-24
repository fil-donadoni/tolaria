// Review panel tests (PRD #1107 story 26, issue #1116; admin-gated + compact
// redesign issue #1583): drives `LimitedReviewPanel` through the `event` prop
// shape the WIRE-FORMAT query (`getLimitedEvent`) actually returns —
// `completed`/`pool`/`humanDeck`/`autoBuiltDeck`/`deckSummary` per the server
// projection — so a dropped field on the server side would surface here too
// (mirrors `limited-vs-ai-panel.test.tsx`'s discipline: never a hand-built
// GameState-shaped view). The server already strips another seat's pool/deck
// for a non-admin, so these tests fix the CLIENT half: a non-admin sees only
// the compact summary, an admin can expand the debug detail.
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
        deckSummary: null,
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

describe("LimitedReviewPanel (issue #1116 / #1583)", () => {
    it("renders nothing while the event is not completed", () => {
        const event = makeEvent({ completed: false, seatsWithDeck: 1 }, [
            { seatIndex: 0, userId: "user-1", isViewer: true, pool: [] },
            { seatIndex: 1, isBot: true },
        ]);
        const { container } = render(
            <LimitedReviewPanel event={event} isAdmin={false} />
        );
        expect(container.firstChild).toBeNull();
    });

    it("shows every seat's compact summary (colors + counts) for a NON-admin, without any card list", () => {
        // A non-admin at a completed event: the server sent no other seat's
        // pool/humanDeck (both null here), only the ungated `deckSummary`.
        const event = makeEvent({ completed: true, seatsWithDeck: 2 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false,
                pool: null,
                humanDeck: null,
                deckSummary: {
                    colors: ["R"],
                    maindeckCount: 40,
                    sideboardCount: 3,
                },
            },
            {
                seatIndex: 1,
                isBot: true,
                nickname: "Bot 2",
                pool: null,
                // autoBuiltDeck stays on the wire (vs-AI hookup) — must NOT be
                // rendered as a deck list for a non-admin.
                autoBuiltDeck: {
                    cards: [{ cardId: "c2", cardName: "Mountain" }],
                    sideboard: [],
                    colors: ["R", "G"],
                },
                deckSummary: {
                    colors: ["R", "G"],
                    maindeckCount: 40,
                    sideboardCount: 5,
                },
            },
        ]);
        const { container, queryByText } = render(
            <LimitedReviewPanel event={event} isAdmin={false} />
        );
        // Summaries render for every seat.
        expect(container.textContent).toContain("40 maindeck / 3 sideboard");
        expect(container.textContent).toContain("R/G");
        // No debug detail: no card list, no bot autoBuiltDeck contents.
        expect(queryByText("Mountain")).toBeNull();
        expect(container.querySelector("details")).toBeNull();
    });

    it("lets a non-admin expand ONLY their own seat's detail", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 2 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: true, // the viewer's own seat
                pool: [{ scryfallId: "s1", cardId: "c1", cardName: "My Pick" }],
                humanDeck: {
                    cards: [{ cardId: "c1", cardName: "My Pick" }],
                    sideboard: [],
                    colors: ["R"],
                },
                deckSummary: {
                    colors: ["R"],
                    maindeckCount: 1,
                    sideboardCount: 0,
                },
            },
            {
                seatIndex: 1,
                userId: "user-2",
                nickname: "Bob",
                isViewer: false,
                pool: null,
                humanDeck: null,
                deckSummary: {
                    colors: ["U"],
                    maindeckCount: 40,
                    sideboardCount: 2,
                },
            },
        ]);
        const { container, getAllByText } = render(
            <LimitedReviewPanel event={event} isAdmin={false} />
        );
        // Exactly one disclosure — the viewer's own seat.
        expect(container.querySelectorAll("details").length).toBe(1);
        expect(getAllByText("My Pick").length).toBeGreaterThan(0);
    });

    it("lets an ADMIN expand any seat to see the built deck and pick order", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 2 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false, // NOT the admin's own seat — admin still sees it
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
                deckSummary: {
                    colors: ["R"],
                    maindeckCount: 1,
                    sideboardCount: 0,
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
                deckSummary: {
                    colors: ["R", "G"],
                    maindeckCount: 1,
                    sideboardCount: 0,
                },
            },
        ]);
        const { getAllByText, container } = render(
            <LimitedReviewPanel event={event} isAdmin={true} />
        );
        expect(getAllByText("Lightning Bolt").length).toBeGreaterThan(0);
        expect(getAllByText("Mountain").length).toBeGreaterThan(0);
        // One disclosure per seat.
        expect(container.querySelectorAll("details").length).toBe(2);
    });

    it("numbers a DRAFT event's pool in pick order (admin detail) instead of grouping by count", () => {
        const event = makeEvent(
            { type: "draft", completed: true, seatsWithDeck: 1 },
            [
                {
                    seatIndex: 0,
                    userId: "user-1",
                    nickname: "Alice",
                    isViewer: false,
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
                    deckSummary: {
                        colors: [],
                        maindeckCount: 0,
                        sideboardCount: 0,
                    },
                },
            ]
        );
        const { getByText, container } = render(
            <LimitedReviewPanel event={event} isAdmin={true} />
        );
        expect(getByText("First Pick")).toBeTruthy();
        expect(getByText("Second Pick")).toBeTruthy();
        // Rendered as an ordered list (<ol>), not the grouped <ul> a Sealed
        // seat uses.
        expect(container.querySelector("ol")).not.toBeNull();
    });

    it("shows 'No deck submitted' in an admin's expanded detail for a human seat with no humanDeck", () => {
        const event = makeEvent({ completed: true, seatsWithDeck: 1 }, [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isViewer: false,
                pool: [],
                humanDeck: null,
                deckSummary: null,
            },
        ]);
        const { getByText } = render(
            <LimitedReviewPanel event={event} isAdmin={true} />
        );
        expect(getByText("No deck submitted.")).toBeTruthy();
    });
});
