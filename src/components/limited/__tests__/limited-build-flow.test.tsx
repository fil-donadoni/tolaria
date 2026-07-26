// Post-Pool flow on the event page. The end of a Draft (or the start of a
// Sealed event) IS the start of deck building, so a seated player with a final
// Pool and no deck is sent straight into the builder instead of being parked
// on a read-only copy of their Pool; once their deck is in, the page becomes
// the table's build-progress summary plus the match lobby. Driven through the
// REAL `LimitedEventDetail` render (the reducer/route wiring is exactly what
// used to break), mirroring `limited-event-detail.test.tsx`'s mocking.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventDetail from "../limited-event-detail";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

const decksMock = vi.fn(() => [] as unknown[]);

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => decksMock(),
}));

/** A saved deck row for seat 0, as `useUserDecks` projects it (legality is
 *  server-derived for Limited decks — see `toUserLobbyDeck`). */
function savedDeck(isLegal: boolean, cardCount: number) {
    return {
        kind: "user",
        userDeckId: "deck-1",
        presetId: "deck-1",
        name: "Alice's Draft Deck",
        format: "limited",
        colors: [],
        cards: Array.from({ length: cardCount }, () => ({
            cardId: "c",
            quantity: 1,
        })),
        sideboard: [],
        featuredCardId: null,
        isLegal,
        reasons: isLegal
            ? []
            : [
                  {
                      code: "size",
                      message: "Maindeck must have at least 40 cards.",
                  },
              ],
        limitedEventId: "event-1",
        limitedSeatId: "0",
    };
}

const eventMock = vi.fn();

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEvent: () => eventMock(),
    useLimitedEventMutations: () => ({
        join: vi.fn(),
        leave: vi.fn(),
        cancel: vi.fn(),
        start: vi.fn(),
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    decksMock.mockReturnValue([]);
});

afterEach(() => {
    cleanup();
});

/** A started Sealed event (Pool final the instant it starts) where the viewer
 *  holds seat 0. `hasDeck` drives the whole branch under test. */
function makeEvent(hasDeck: boolean): LimitedEventView {
    return {
        _id: "event-1",
        createdBy: "user-1",
        type: "sealed",
        status: "started",
        completed: false,
        seatCount: 2,
        seatsWithDeck: hasDeck ? 1 : 0,
        packSlots: ["lea"],
        seats: [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isBot: false,
                isViewer: true,
                hasDeck,
                poolCount: 45,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
            },
            {
                seatIndex: 1,
                nickname: "Bot 2",
                isBot: true,
                isViewer: false,
                hasDeck: true,
                poolCount: 45,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
            },
        ],
        createdAt: 0,
        updatedAt: 0,
    } as unknown as LimitedEventView;
}

describe("LimitedEventDetail — Pool final, no deck yet", () => {
    it("sends the seated player straight into the deck builder", () => {
        eventMock.mockReturnValue(makeEvent(false));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId/build",
            params: { eventId: "event-1" },
        });
    });

    it("does not bounce them back in a second time (Back to Event must stick)", () => {
        eventMock.mockReturnValue(makeEvent(false));

        const first = render(
            <LimitedEventDetail eventId={"event-1" as never} />
        );
        expect(navigate).toHaveBeenCalledTimes(1);
        first.unmount();
        navigate.mockClear();

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(navigate).not.toHaveBeenCalled();
    });

    it("offers the way back into the builder instead of a read-only Pool dump", () => {
        eventMock.mockReturnValue(makeEvent(false));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Your Pool is ready")).toBeTruthy();
        expect(screen.getByText("Build Deck")).toBeTruthy();
    });
});

describe("LimitedEventDetail — deck submitted", () => {
    it("never auto-opens the builder for a player who is done building", () => {
        eventMock.mockReturnValue(makeEvent(true));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(navigate).not.toHaveBeenCalled();
    });

    it("swaps the build prompt for the deck's own state and shows the table's build progress", () => {
        eventMock.mockReturnValue(makeEvent(true));
        decksMock.mockReturnValue([savedDeck(true, 40)]);

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText("Your Pool is ready")).toBe(null);
        expect(screen.getByText("Table")).toBeTruthy();
        expect(screen.getByText("1/2 decks in")).toBeTruthy();
        const bar = screen.getByRole("progressbar");
        expect(bar.getAttribute("aria-valuenow")).toBe("1");
        expect(bar.getAttribute("aria-valuemax")).toBe("2");
    });
});

describe("LimitedEventDetail — deck saved but not legal yet", () => {
    // Leaving the builder always saves, so a player who walked out at 30 cards
    // has a deck row (the seat counts as "deck in") that cannot start a Match.
    // The page must still offer the way back into the builder — hiding it on
    // `hasDeck` stranded them with nothing but dead Play buttons.
    beforeEach(() => {
        eventMock.mockReturnValue(makeEvent(true));
        decksMock.mockReturnValue([savedDeck(false, 30)]);
    });

    it("keeps an Edit Deck action on the page", () => {
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Edit Deck")).toBeTruthy();
    });

    it("says why the deck isn't playable yet", () => {
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Your deck isn't ready to play")).toBeTruthy();
        expect(
            screen.getByText("Maindeck must have at least 40 cards.")
        ).toBeTruthy();
    });
});

describe("LimitedEventDetail — legal deck", () => {
    it("reports the deck as ready and still allows editing it", () => {
        eventMock.mockReturnValue(makeEvent(true));
        decksMock.mockReturnValue([savedDeck(true, 40)]);

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Your deck · 40 cards")).toBeTruthy();
        expect(screen.getByText("Edit Deck")).toBeTruthy();
    });
});
