// Round-action tests (PRD #1628 stories 8-13, issue #1645).
//
// The `event` prop is produced by the REAL reducer — `projectLimitedEvent`
// (`convex/limited/eventProjection.ts`), the same seam the wire-format query
// returns — never a hand-built view (CLAUDE.md § Frontend wiring analysis): the
// whole action surface is driven off `viewerPairing.matchId` /
// `opponentIsBot`, which are exactly the fields a projection drop would silence.
// Mocking discipline mirrors `limited-vs-ai-panel.test.tsx`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    render,
    screen,
    cleanup,
    fireEvent,
    waitFor,
} from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedRoundPanel from "../limited-round-panel";

const navigate = vi.fn();
const storeSession = vi.fn();
const startPairingMatch = vi.fn();
const joinGame = vi.fn();
let activeGame: unknown = null;
let userDecksMock: unknown[] | undefined = [];

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

vi.mock("convex/react", () => ({
    // The action holds exactly two mutations; the generated `api` is a proxy
    // in tests, so they're told apart by call order the component makes them
    // in (`startPairingMatch` first, then `joinGame`).
    useMutation: (ref: { __name?: string }) =>
        ref?.__name === "joinGame" ? joinGame : startPairingMatch,
    useQuery: () => activeGame,
}));

vi.mock("@convex/_generated/api", () => {
    const make = (name: string): unknown =>
        new Proxy(
            { __name: name },
            {
                get: (_target, key) =>
                    key === "__name" ? name : make(String(key)),
            }
        );
    return { api: make("api") };
});

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user1", nickname: "Alice" }),
}));

vi.mock("~/hooks/useUserDecks", () => ({ useUserDecks: () => userDecksMock }));

vi.mock("~/lib/session", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    storeSession: (...args: unknown[]) => storeSession(...args),
}));

const LEGAL_DECK = {
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
    limitedEventId: "event-1645",
    limitedSeatId: "0",
};

beforeEach(() => {
    vi.clearAllMocks();
    startPairingMatch.mockResolvedValue("game-1");
    joinGame.mockResolvedValue(null);
    activeGame = null;
    userDecksMock = [LEGAL_DECK];
});

afterEach(() => {
    cleanup();
});

type Pairings = NonNullable<LimitedEventRow["rounds"]>[number]["pairings"];

const EVENT_ID = "event-1645" as Id<"limitedEvents">;

/** A 4-seat table in the play phase: seats 0/1 human (Alice/Bob), 2/3 bots. */
function projectedEvent(
    pairings: Pairings,
    extra: Partial<LimitedEventView> = {}
): LimitedEventView {
    const row: LimitedEventRow = {
        _id: "event-1645",
        createdBy: "user1",
        type: "draft",
        status: "playing",
        seatCount: 4,
        packSlots: ["lea"],
        matchFormat: "bo3",
        currentRound: 1,
        rounds: [{ roundNumber: 1, startedAt: 1000, pairings }],
        seats: [
            { seatIndex: 0, userId: "user1", nickname: "Alice" },
            { seatIndex: 1, userId: "user2", nickname: "Bob" },
            { seatIndex: 2, nickname: "Bot 3", isBot: true },
            { seatIndex: 3, nickname: "Bot 4", isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
    return {
        // The query shell (`projectEventForViewer`) zips the viewer's
        // challenges onto the pure projection — mirror that here rather than
        // replacing the projection itself.
        ...(projectLimitedEvent(row, "user1") as unknown as LimitedEventView),
        viewerIncomingChallenges: [],
        viewerOutgoingChallenge: null,
        ...extra,
    };
}

function renderPanel(event: LimitedEventView) {
    return render(<LimitedRoundPanel eventId={EVENT_ID} event={event} />);
}

describe("LimitedRoundAction — starting the pairing (PRD stories 8-11)", () => {
    it("offers Start Match for an unstarted bot pairing and enters the vs-AI seat", async () => {
        renderPanel(projectedEvent([{ seatA: 0, seatB: 2 }]));

        fireEvent.click(screen.getByText("Start Match"));

        await waitFor(() => expect(startPairingMatch).toHaveBeenCalled());
        expect(startPairingMatch.mock.calls[0][0]).toMatchObject({
            eventId: EVENT_ID,
        });
        // vs-AI Match: the viewer drives the `-p1` seat (ADR 0001).
        await waitFor(() =>
            expect(storeSession).toHaveBeenCalledWith("game-1", "user1-p1")
        );
        expect(navigate).toHaveBeenCalledWith({ to: "/game" });
    });

    it("offers Start Match for an unstarted HUMAN pairing and seats the user's own id", async () => {
        renderPanel(projectedEvent([{ seatA: 0, seatB: 1 }]));

        fireEvent.click(screen.getByText("Start Match"));

        await waitFor(() =>
            expect(storeSession).toHaveBeenCalledWith("game-1", "user1")
        );
    });

    it("never sends the client's own decklist for the bot seat — only the viewer's deck", async () => {
        renderPanel(projectedEvent([{ seatA: 0, seatB: 2 }]));
        fireEvent.click(screen.getByText("Start Match"));

        await waitFor(() => expect(startPairingMatch).toHaveBeenCalled());
        const args = startPairingMatch.mock.calls[0][0] as Record<
            string,
            unknown
        >;
        expect(Object.keys(args).sort()).toEqual(["deck", "eventId"]);
    });

    it("surfaces the server's refusal instead of navigating", async () => {
        startPairingMatch.mockRejectedValue(
            new Error("Your Match for this round has already started.")
        );
        renderPanel(projectedEvent([{ seatA: 0, seatB: 2 }]));

        fireEvent.click(screen.getByText("Start Match"));

        await waitFor(() =>
            expect(screen.getByText(/already started/).textContent).toBeTruthy()
        );
        expect(navigate).not.toHaveBeenCalled();
    });

    it("blocks the action for a seat with no legal deck", () => {
        userDecksMock = [{ ...LEGAL_DECK, isLegal: false }];
        renderPanel(projectedEvent([{ seatA: 0, seatB: 2 }]));

        expect(
            screen.getByText("Start Match").closest("button")!.disabled
        ).toBe(true);
        expect(screen.getByTestId("round-needs-deck")).toBeTruthy();
    });
});

describe("LimitedRoundAction — the opponent's side (PRD story 10)", () => {
    it("offers Accept Match when the paired opponent started it", async () => {
        const event = projectedEvent(
            [{ seatA: 1, seatB: 0, matchId: "match-1" }],
            {
                viewerIncomingChallenges: [
                    { gameId: "game-7", challengerSeatIndex: 1 },
                ],
            }
        );
        renderPanel(event);

        fireEvent.click(screen.getByText("Accept Match"));

        await waitFor(() => expect(joinGame).toHaveBeenCalled());
        expect(joinGame.mock.calls[0][0]).toMatchObject({ gameId: "game-7" });
        await waitFor(() =>
            expect(storeSession).toHaveBeenCalledWith("game-7", "user1")
        );
    });

    it("ignores a challenge from a seat that is NOT the viewer's pairing", () => {
        const event = projectedEvent([{ seatA: 0, seatB: 2 }], {
            viewerIncomingChallenges: [
                { gameId: "game-9", challengerSeatIndex: 1 },
            ],
        });
        renderPanel(event);

        expect(screen.queryByText("Accept Match")).toBeNull();
        expect(screen.getByText("Start Match")).toBeTruthy();
    });

    it("waits for the opponent once the viewer started a human pairing", () => {
        renderPanel(
            projectedEvent([{ seatA: 0, seatB: 1, matchId: "match-1" }])
        );

        expect(screen.getByTestId("round-waiting-accept")).toBeTruthy();
        expect(screen.queryByText("Start Match")).toBeNull();
    });
});

describe("LimitedRoundAction — resuming, and when it hides", () => {
    it("offers Resume Match when the viewer's active Match IS this pairing's", async () => {
        activeGame = {
            gameId: "game-3",
            matchId: "match-1",
            solo: true,
            vsAi: true,
        };
        renderPanel(
            projectedEvent([{ seatA: 0, seatB: 2, matchId: "match-1" }])
        );

        fireEvent.click(screen.getByText("Resume Match"));

        await waitFor(() =>
            expect(storeSession).toHaveBeenCalledWith("game-3", "user1-p1")
        );
    });

    it("does NOT offer resume for an active Match belonging to another pairing", () => {
        activeGame = {
            gameId: "game-3",
            matchId: "match-other",
            solo: false,
            vsAi: false,
        };
        renderPanel(
            projectedEvent([{ seatA: 0, seatB: 2, matchId: "match-1" }])
        );

        expect(screen.queryByText("Resume Match")).toBeNull();
    });

    it("renders no action for a decided pairing or a bye", () => {
        renderPanel(
            projectedEvent([
                {
                    seatA: 0,
                    seatB: 2,
                    result: { winsA: 2, winsB: 0, source: "played" },
                },
            ])
        );
        expect(screen.queryByTestId("round-action")).toBeNull();
        cleanup();

        renderPanel(
            projectedEvent([
                { seatA: 0, result: { winsA: 2, winsB: 0, source: "bye" } },
            ])
        );
        expect(screen.queryByTestId("round-action")).toBeNull();
    });
});
