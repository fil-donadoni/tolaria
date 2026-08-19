// Share/invite affordance stays reachable after the event starts (issue
// #1578): previously gated to `status === "open"`, so a participant who
// left the page (or received the link secondhand) had no in-app way to
// re-copy it once the event was underway. Drives the SURFACE assertion
// through the real `LimitedEventDetail` render, mirroring
// `limited-vs-ai-panel.test.tsx`'s mocking discipline.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventDetail from "../limited-event-detail";

// `LimitedDraftTable` (mounted while drafting) pulls in `LimitedDraftTimer`,
// which reads `useReducedMotion` from `motion/react` — happy-dom has no
// `matchMedia` by default, and the chrome-collapse tests below stub one that
// only answers `useViewportMode`'s two queries, so this needs its own stub
// (mirrors `limited-draft-table.test.tsx`'s discipline).
vi.mock("motion/react", () => ({
    useReducedMotion: () => false,
}));

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

// Issue #2515: on a compact viewport the event's own chrome (title, badges,
// Seats, Close Event, the decorative frame) pushed the first pack card to 86%
// of a landscape phone screen while drafting. The collapse is gated on BOTH
// `draftInProgress` AND a compact viewport — get either alone wrong and an
// acceptance criterion breaks (viewport-only strips chrome off a
// non-drafting event; drafting-only changes desktop). happy-dom's
// `useViewportMode()` falls back to "desktop" with no `matchMedia`
// (`src/hooks/useViewportMode.ts`), which is exactly why every test ABOVE
// this block keeps passing unchanged — none of them reach the compact
// branch. Reaching it here requires an explicit `matchMedia` stub that
// answers the hook's own two queries (mirrors
// `src/hooks/__tests__/useViewportMode.test.ts`'s discipline), not a mock of
// the hook itself — a hook-level mock would prove the component reads SOME
// boolean, not that it reads the REAL media query the CSS `compact-chrome:`
// variant also keys on.
describe("chrome collapses while drafting on a compact viewport (issue #2515)", () => {
    function stubLandscapeCompactViewport() {
        vi.stubGlobal(
            "matchMedia",
            (query: string) =>
                ({
                    media: query,
                    // Only the landscape-phone query matches — exactly
                    // `useViewportMode()`'s "landscape-compact" mode, i.e.
                    // `mode !== "desktop"`.
                    matches: query.includes("orientation: landscape"),
                    addEventListener: () => {},
                    removeEventListener: () => {},
                    addListener: () => {},
                    removeListener: () => {},
                    onchange: null,
                    dispatchEvent: () => true,
                }) as MediaQueryList
        );
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("folds title/badges/Seats/Close Event behind a toggle while drafting, keeping the Booster meta row and a way back", () => {
        stubLandscapeCompactViewport();
        eventMock.mockReturnValue(
            makeEvent({
                type: "draft",
                status: "started",
                createdBy: "user-1",
                packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
            })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText("Vintage Cube Draft")).toBeNull();
        expect(screen.queryByText("drafting")).toBeNull();
        expect(screen.queryByText(/Seats ·/)).toBeNull();
        expect(screen.queryByText("Close Event")).toBeNull();

        // The Booster meta row — the whole point of the collapse — stays
        // resident, and a way back is reachable without opening the
        // disclosure.
        expect(screen.getByText(/Booster 1 of/)).toBeTruthy();
        expect(screen.getByText("← Back to Limited Events")).toBeTruthy();

        // Reachable, not removed: the toggle expands the folded band back.
        const toggle = screen.getByRole("button", { name: /Event Details/ });
        fireEvent.click(toggle);
        expect(screen.getByText("Vintage Cube Draft")).toBeTruthy();
        expect(screen.getByText("Close Event")).toBeTruthy();
    });

    // Review round 1, finding 1 (medium, blocking): happy-dom has no layout
    // engine, so it cannot see the ~16px occlusion itself (that's why round 1
    // shipped with no test or probe covering this state at all — the browser
    // probe below is the geometric evidence). What happy-dom CAN see is the
    // structural cause: `PanelHeader`'s `.panel-header-band` (`panel.tsx`)
    // carries `-mt-2 sm:-mt-4` — built to climb to a Panel's TOP edge — and at
    // >=640px (which includes the 844x390 landscape-phone target viewport)
    // that 16px climbed back over the persistent Back link + this toggle,
    // covering ~16 of their ~22px and capturing their clicks. This asserts
    // the fix's actual mechanism: the EXPANDED folded band never renders that
    // flush-top wrapper mid-panel, and both controls above it stay reachable
    // (present, not `disabled`, no `aria-hidden`) once expanded.
    //
    // Proof of failure: reverting the fix in `limited-event-detail.tsx`
    // (rendering `<PanelHeader title={limitedEventName(event)} />`
    // unconditionally instead of branching on `collapseChrome`) makes the
    // `.panel-header-band` assertion below fail — `document.querySelector`
    // finds the band's div instead of `null`.
    it("renders the expanded folded band as a plain heading, not a flush-top PanelHeader band, so the Back link and toggle above it stay reachable", () => {
        stubLandscapeCompactViewport();
        eventMock.mockReturnValue(
            makeEvent({
                type: "draft",
                status: "started",
                createdBy: "user-1",
                packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
            })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        const backLink = screen.getByText("← Back to Limited Events");
        const backButton = backLink.closest("button");
        const toggle = screen.getByRole("button", { name: /Event Details/ });
        expect(backButton?.disabled).toBe(false);
        expect((toggle as HTMLButtonElement).disabled).toBe(false);

        fireEvent.click(toggle);

        // The would-be-occluding wrapper must not exist at all in this state.
        expect(document.querySelector(".panel-header-band")).toBeNull();

        // Both controls above the (now-plain) heading remain present and
        // reachable — not removed, not disabled, not hidden from a11y.
        expect(backLink.isConnected).toBe(true);
        expect(backLink.closest("button")?.disabled).toBe(false);
        expect(backLink.closest("[aria-hidden='true']")).toBeNull();
        const reopenedToggle = screen.getByRole("button", {
            name: /Event Details/,
        });
        expect((reopenedToggle as HTMLButtonElement).disabled).toBe(false);
        expect(reopenedToggle.closest("[aria-hidden='true']")).toBeNull();

        // The title itself must still be showing, just via the plain heading.
        expect(screen.getByText("Vintage Cube Draft")).toBeTruthy();
    });

    it("keeps the full chrome on the SAME compact viewport when the event is NOT drafting", () => {
        stubLandscapeCompactViewport();
        eventMock.mockReturnValue(
            makeEvent({ type: "sealed", status: "open", createdBy: "user-1" })
        );

        render(<LimitedEventDetail eventId={"event-1" as never} />);

        // Never folded: no toggle exists at all off a Draft.
        expect(
            screen.queryByRole("button", { name: /Event Details/ })
        ).toBeNull();
        // The event name, seatingOpen's own "Cancel Event" label (creator,
        // still open) and the toolbar's own Back link all render exactly as
        // the non-drafting suites above already prove they do on desktop.
        expect(screen.getByText("Limited Edition Alpha Sealed")).toBeTruthy();
        expect(screen.getByText("Cancel Event")).toBeTruthy();
        expect(screen.getByText("← Back to Limited Events")).toBeTruthy();
    });
});

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
