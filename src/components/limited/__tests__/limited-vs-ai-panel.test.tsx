// Play-vs-the-Table panel tests (PRD #1107 stories 24-25, ADR 0054/0055,
// issue #1115): drives `LimitedVsAiPanel` exactly the way `limited-event-
// detail.tsx` wires it — through the `event` prop the wire-format query
// returns (`autoBuiltDeck` per bot seat) — so a dropped field on the SERVER
// projection would surface here too, not just in `convex/limited/__tests__/
// autoBuild.test.ts`'s server-side assertions. Mirrors
// `join-game.test.tsx`'s mocking discipline (mock `convex/react`, the
// generated `api`, and the project's own hooks — never hand-build a
// GameState-shaped view).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedVsAiPanel from "../limited-vs-ai-panel";

const navigate = vi.fn();
const createSoloGame = vi.fn().mockResolvedValue("game-1");
const storeSession = vi.fn();
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

let userDecksMock: unknown[] | undefined = [];
vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => userDecksMock,
}));

vi.mock("~/lib/session", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    storeSession: (...args: unknown[]) => storeSession(...args),
}));

beforeEach(() => {
    vi.clearAllMocks();
    createSoloGame.mockResolvedValue("game-1");
    useMutationMock.mockReturnValue(createSoloGame);
    userDecksMock = [];
});

afterEach(() => {
    cleanup();
});

const HUMAN_DECK = {
    kind: "user" as const,
    userDeckId: "deck-1",
    presetId: "deck-1",
    name: "Alice's Sealed Deck",
    format: "limited" as const,
    colors: ["R", "G"],
    cards: [{ cardId: "card-a", cardName: "Lightning Bolt" }],
    sideboard: [{ cardId: "card-b", cardName: "Grizzly Bears" }],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
    limitedEventId: "event-1",
    limitedSeatId: "0",
};

function makeEvent(
    seatsOverride: Partial<LimitedEventView["seats"][number]>[]
): LimitedEventView {
    const base = {
        userId: undefined,
        nickname: undefined,
        isBot: false,
        isViewer: false,
        poolCount: null,
        pool: null,
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
        seats: seatsOverride.map((s, i) => ({
            ...base,
            seatIndex: i,
            ...s,
        })),
        createdAt: 0,
        updatedAt: 0,
    } as unknown as LimitedEventView;
}

describe("LimitedVsAiPanel (issue #1115)", () => {
    it("renders nothing when no bot seat has an Auto-Built deck", () => {
        const event = makeEvent([
            { seatIndex: 0, userId: "user-1", isViewer: true },
            { seatIndex: 1, isBot: true, autoBuiltDeck: null },
        ]);
        const { container } = render(
            <LimitedVsAiPanel
                eventId={"event-1" as never}
                event={event}
                viewerSeatIndex={0}
            />
        );
        expect(container.firstChild).toBeNull();
    });

    it("prompts to build a deck first when the viewer has no matching userDecks row", () => {
        userDecksMock = [];
        const event = makeEvent([
            { seatIndex: 0, userId: "user-1", isViewer: true },
            {
                seatIndex: 1,
                isBot: true,
                nickname: "Bot 2",
                autoBuiltDeck: {
                    cards: [{ cardId: "c1", cardName: "Mountain" }],
                    sideboard: [],
                    colors: ["R", "G"],
                },
            },
        ]);
        const { getByText, queryByText } = render(
            <LimitedVsAiPanel
                eventId={"event-1" as never}
                event={event}
                viewerSeatIndex={0}
            />
        );
        expect(getByText(/Build your deck/)).toBeTruthy();
        expect(queryByText("Play")).toBeNull();
    });

    it("lists a bot seat with its color pair and starts a vs-AI Match on Play", async () => {
        userDecksMock = [HUMAN_DECK];
        const event = makeEvent([
            { seatIndex: 0, userId: "user-1", isViewer: true },
            {
                seatIndex: 1,
                isBot: true,
                nickname: "Bot 2",
                autoBuiltDeck: {
                    cards: [
                        { cardId: "c1", cardName: "Shivan Dragon" },
                        { cardId: "c2", cardName: "Mountain" },
                    ],
                    sideboard: [{ cardId: "c3", cardName: "Grizzly Bears" }],
                    colors: ["R", "G"],
                },
            },
        ]);
        const { getByText, getByAltText } = render(
            <LimitedVsAiPanel
                eventId={"event-1" as never}
                event={event}
                viewerSeatIndex={0}
            />
        );

        expect(getByText("Bot 2")).toBeTruthy();
        // Deck colors render as mana symbols (project rule: never letters) —
        // one <img alt="{R}"> per color, not an "R/G" string.
        expect(getByAltText("{R}")).toBeTruthy();
        expect(getByAltText("{G}")).toBeTruthy();

        fireEvent.click(getByText("Play"));

        await waitFor(() => expect(createSoloGame).toHaveBeenCalledTimes(1));
        const arg = createSoloGame.mock.calls[0][0];
        expect(arg.vsAi).toBe(true);
        expect(arg.deck.name).toBe("Alice's Sealed Deck");
        expect(arg.deck.limitedEventId).toBe("event-1");
        expect(arg.deck.limitedSeatId).toBe("0");
        // The bot's Auto-Built deck rides on the wire as "freeform" — it
        // can't carry a limitedEventId/limitedSeatId owned by the human
        // (issue #1115: the ownership gate would reject it), and Freeform's
        // validator is a permissive no-op.
        expect(arg.deck2.format).toBe("freeform");
        expect(arg.deck2.cards).toEqual([
            { cardId: "c1", cardName: "Shivan Dragon" },
            { cardId: "c2", cardName: "Mountain" },
        ]);
        expect(arg.deck2.sideboard).toEqual([
            { cardId: "c3", cardName: "Grizzly Bears" },
        ]);
        expect(arg.deck2.limitedEventId).toBeUndefined();
        expect(arg.deck2.limitedSeatId).toBeUndefined();

        await waitFor(() =>
            expect(storeSession).toHaveBeenCalledWith("game-1", "user-1-p1")
        );
        await waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({ to: "/game" })
        );
    });
});
