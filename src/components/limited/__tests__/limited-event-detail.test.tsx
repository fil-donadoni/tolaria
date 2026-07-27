// Share/invite affordance stays reachable after the event starts (issue
// #1578): previously gated to `status === "open"`, so a participant who
// left the page (or received the link secondhand) had no in-app way to
// re-copy it once the event was underway. Drives the SURFACE assertion
// through the real `LimitedEventDetail` render, mirroring
// `limited-vs-ai-panel.test.tsx`'s mocking discipline.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventDetail from "../limited-event-detail";

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

// `LimitedVsAiPanel` renders for any started+pool-final event with a viewer
// seat — pull in its own mocking discipline (`limited-vs-ai-panel.test.tsx`)
// so a STARTED-status fixture here doesn't crash on a missing ConvexProvider.
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

// Mutable so the challenge-panel-visibility tests below can give the viewer
// a legal deck for the event (`LimitedChallengePanel` renders nothing at all
// without one) without disturbing every other test in this file, which relies
// on the empty default (mirrors `limited-round-action.test.tsx`'s
// `userDecksMock` idiom).
let userDecksMock: unknown[] | undefined = [];

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => userDecksMock,
}));

const eventMock = vi.fn();

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEvent: () => eventMock(),
    useLimitedEventMutations: () => ({
        join: vi.fn(),
        start: vi.fn(),
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    userDecksMock = [];
});

afterEach(() => {
    cleanup();
});

function makeEvent(overrides: Partial<LimitedEventView>): LimitedEventView {
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "sealed",
        status: "open",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        viewerIncomingChallenges: [],
        viewerOutgoingChallenge: null,
        packSlots: ["lea"],
        seats: [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isBot: false,
                isViewer: true,
                poolCount: null,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
            },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as LimitedEventView;
}

describe("LimitedEventDetail — share/invite reachable post-start (issue #1578)", () => {
    it("shows the share/invite button for an OPEN event", () => {
        eventMock.mockReturnValue(makeEvent({ status: "open" }));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Share invite link")).toBeTruthy();
    });

    it("still shows the link button once the event has STARTED — as a plain event link, not an invite", () => {
        eventMock.mockReturnValue(makeEvent({ status: "started" }));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Copy event link")).toBeTruthy();
        expect(screen.queryByText("Share invite link")).toBe(null);
    });

    it("still shows the link button once the event is COMPLETED", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "started", completed: true })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Copy event link")).toBeTruthy();
    });
});

describe("LimitedEventDetail — start hint follows the Start button", () => {
    const HINT = /You can start the event at any time/;

    it("shows the hint to the creator while the event is still open", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "user-1" })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText(HINT)).toBeTruthy();
    });

    it("hides the hint for a non-creator (no Start button to explain)", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "open", createdBy: "someone-else" })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText(HINT)).toBe(null);
    });

    it("hides the hint once the event has started", () => {
        eventMock.mockReturnValue(
            makeEvent({ status: "started", createdBy: "user-1" })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText(HINT)).toBe(null);
    });
});

describe("LimitedEventDetail — header (format name + phase chip)", () => {
    it("titles the page with the event's format name, not the raw type/packSlots", () => {
        eventMock.mockReturnValue(
            makeEvent({
                type: "draft",
                status: "started",
                packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
            })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Vintage Cube Draft")).toBeTruthy();
        expect(screen.queryByText(/VINTAGE-CUBE, VINTAGE-CUBE/)).toBe(null);
    });

    it("shows the PHASE (drafting) rather than the raw DB status (started)", () => {
        eventMock.mockReturnValue(
            makeEvent({ type: "draft", status: "started", packSlots: ["lea"] })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("drafting")).toBeTruthy();
        expect(screen.queryByText(/started/)).toBe(null);
    });
});

describe("LimitedEventDetail — standings table (PRD #1628 stories 22-24, issue #1643)", () => {
    it("does not render the standings table before the play phase starts", () => {
        eventMock.mockReturnValue(
            makeEvent({
                status: "started",
                rounds: [],
                standings: [
                    {
                        seatIndex: 0,
                        points: 0,
                        matchWins: 0,
                        matchLosses: 0,
                        matchDraws: 0,
                        gameWins: 0,
                        gameLosses: 0,
                        gameWinPct: 0,
                        opponentMatchWinPct: 0,
                    },
                ],
            })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText("Standings")).toBe(null);
    });

    it("renders the standings table, with the viewer's own seat highlighted, once rounds are running", () => {
        eventMock.mockReturnValue(
            makeEvent({
                status: "playing",
                currentRound: 1,
                rounds: [
                    {
                        roundNumber: 1,
                        startedAt: 0,
                        pairings: [
                            {
                                seatA: 0,
                                seatB: 1,
                                result: {
                                    winsA: 2,
                                    winsB: 0,
                                    source: "played",
                                },
                            },
                        ],
                    },
                ],
                standings: [
                    {
                        seatIndex: 0,
                        points: 3,
                        matchWins: 1,
                        matchLosses: 0,
                        matchDraws: 0,
                        gameWins: 2,
                        gameLosses: 0,
                        gameWinPct: 1,
                        opponentMatchWinPct: 0,
                    },
                    {
                        seatIndex: 1,
                        points: 0,
                        matchWins: 0,
                        matchLosses: 1,
                        matchDraws: 0,
                        gameWins: 0,
                        gameLosses: 2,
                        gameWinPct: 0,
                        opponentMatchWinPct: 0,
                    },
                ],
                seats: [
                    {
                        seatIndex: 0,
                        userId: "user-1",
                        nickname: "Alice",
                        isBot: false,
                        isViewer: true,
                        poolCount: 40,
                        pool: null,
                        humanDeck: null,
                        deckSummary: null,
                        currentPack: null,
                        packQueueCount: null,
                        pickDeadline: null,
                        poolArrangement: null,
                        selectedPickId: null,
                        hasDeck: false,
                        autoBuiltDeck: null,
                    },
                    {
                        seatIndex: 1,
                        isBot: true,
                        nickname: "Bot 2",
                        isViewer: false,
                        poolCount: 40,
                        pool: null,
                        humanDeck: null,
                        deckSummary: null,
                        currentPack: null,
                        packQueueCount: null,
                        pickDeadline: null,
                        poolArrangement: null,
                        selectedPickId: null,
                        hasDeck: false,
                        autoBuiltDeck: null,
                    },
                ],
            })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Standings")).toBeTruthy();
        const viewerRow = document.querySelector('[data-seat-index="0"]')!;
        expect(viewerRow.getAttribute("data-is-viewer")).toBe("true");
        expect(viewerRow.textContent).toContain("Alice");
    });
});

// Free challenges / Play-vs-Bots are hidden while the event's rounds are
// running and reappear, labelled as unrecorded, once it's finished (PRD
// #1628 stories 36-38, issue #1648). PR #1676 already wired the hide/reappear
// mechanic (`!showRoundPanel`, off `areRoundsRunning`/`isEventConcluded`);
// this pins the part #1648 actually adds — the "unrecorded" label — and
// exercises the reappear path end to end, which had no test before.
function makePoolFinalEvent(
    status: "started" | "playing" | "finished"
): LimitedEventView {
    return makeEvent({
        status,
        standings: [],
        seats: [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                isBot: false,
                isViewer: true,
                poolCount: 40,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: null,
            },
            {
                seatIndex: 1,
                isBot: true,
                nickname: "Bot 2",
                isViewer: false,
                poolCount: 40,
                pool: null,
                currentPack: null,
                packQueueCount: null,
                pickDeadline: null,
                autoBuiltDeck: {
                    cards: [{ cardId: "c1", cardName: "Mountain" }],
                    sideboard: [],
                    colors: ["R"],
                },
            },
        ],
    } as unknown as Partial<LimitedEventView>);
}

describe("free challenges / Play-vs-Bots hide during rounds, reappear labelled at finish (issue #1648)", () => {
    it("hides Play-vs-Bots and the unrecorded label while the event's rounds are running", () => {
        eventMock.mockReturnValue(makePoolFinalEvent("playing"));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText("Play vs Bots")).toBeNull();
        expect(screen.queryByText(/unrecorded playtesting/i)).toBeNull();
    });

    it("shows Play-vs-Bots with no unrecorded label during draft/deckbuild (unaffected, AC)", () => {
        eventMock.mockReturnValue(makePoolFinalEvent("started"));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Play vs Bots")).toBeTruthy();
        expect(screen.queryByText(/unrecorded playtesting/i)).toBeNull();
    });

    it("brings Play-vs-Bots back, labelled unrecorded, once the event is finished", () => {
        eventMock.mockReturnValue(makePoolFinalEvent("finished"));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Play vs Bots")).toBeTruthy();
        expect(screen.getByText(/unrecorded playtesting/i)).toBeTruthy();
    });
});

// `LimitedChallengePanel` visibility across the play-phase lifecycle
// (finding 2, PR #1681 review, issue #1648): `makePoolFinalEvent` above seats
// only a BOT opponent, so `LimitedChallengePanel` — which only ever pairs two
// HUMANS — returns null in EVERY status above, and nothing in this file
// actually asserted "the free challenge panel hides while rounds run /
// reappears once finished". This fixture gives the viewer a second HUMAN
// opponent seat and a legal saved deck of their own (both required for the
// panel to render anything at all), and drives the view through the REAL
// `projectLimitedEvent` reducer — never a hand-built view (CLAUDE.md §
// Frontend wiring analysis) — so a projection drop of `hasDeck`/`userId`
// would surface here too.
const CHALLENGE_LEGAL_DECK = {
    kind: "user" as const,
    userDeckId: "userdeck-1",
    presetId: "userdeck-1",
    name: "Alice's Sealed Deck",
    format: "limited" as const,
    colors: ["R"],
    cards: [{ cardId: "card-a", cardName: "Mountain" }],
    sideboard: [],
    featuredCardId: null,
    isLegal: true,
    reasons: [],
    limitedEventId: "event-1",
    limitedSeatId: "0",
};

function projectedChallengeableEvent(
    status: "started" | "playing" | "finished"
): LimitedEventView {
    const row: LimitedEventRow = {
        _id: "event-1",
        createdBy: "user-1",
        type: "sealed",
        status,
        seatCount: 2,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        matchFormat: "bo3",
        seats: [
            {
                seatIndex: 0,
                userId: "user-1",
                nickname: "Alice",
                poolCount: 40,
            },
            { seatIndex: 1, userId: "user-2", nickname: "Bob", poolCount: 40 },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
    const projected = projectLimitedEvent(
        row,
        "user-1",
        false,
        2,
        new Map(),
        // Both seats have a submitted deck — the real `hasDeck` flag
        // `LimitedChallengePanel`'s opponent filter reads.
        new Set([0, 1])
    ) as unknown as LimitedEventView;
    return {
        // The query shell zips the viewer's challenges onto the pure
        // projection — mirror that here rather than replacing the
        // projection itself (`limited-round-action.test.tsx`'s idiom). Not
        // exercised by this fixture: the panel renders off `myDeck` +
        // `opponentSeats`, not `viewerIncomingChallenges`.
        ...projected,
        viewerIncomingChallenges: [],
        viewerOutgoingChallenge: null,
    };
}

describe("LimitedChallengePanel hides during rounds, reappears at finish (finding 2, issue #1648 review)", () => {
    it("hides the challenge panel while the event's rounds are running", () => {
        userDecksMock = [CHALLENGE_LEGAL_DECK];
        eventMock.mockReturnValue(projectedChallengeableEvent("playing"));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText("Challenge a Player")).toBeNull();
    });

    it("shows the challenge panel during draft/deckbuild (unaffected, AC)", () => {
        userDecksMock = [CHALLENGE_LEGAL_DECK];
        eventMock.mockReturnValue(projectedChallengeableEvent("started"));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Challenge a Player")).toBeTruthy();
    });

    it("brings the challenge panel back once the event is finished", () => {
        userDecksMock = [CHALLENGE_LEGAL_DECK];
        eventMock.mockReturnValue(projectedChallengeableEvent("finished"));

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.getByText("Challenge a Player")).toBeTruthy();
    });
});
