// The event page skeleton (PRD #5383, issue #5389): one primary CTA per
// phase, secondary actions only in the ⋯ menu, the stepper marking the
// current phase. Drives the REAL `LimitedEventDetail` render per phase.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import LimitedEventDetail from "../limited-event-detail";

// `motion/react`'s `useReducedMotion` reads `matchMedia`, which happy-dom
// does not provide by default. The pick screen itself moved out of this page
// in issue #2587, but the stub stays: other panels on the page animate too,
// and a missing `matchMedia` is a crash, not a degraded render.
vi.mock("motion/react", () => ({
    useReducedMotion: () => false,
}));

const navigateMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigateMock,
    Link: ({
        children,
        to,
        params,
        ...rest
    }: {
        children: React.ReactNode;
        to: string;
        params?: Record<string, string>;
    } & Record<string, unknown>) => (
        <a
            href={Object.entries(params ?? {}).reduce(
                (path, [key, value]) => path.replace(`$${key}`, value),
                to
            )}
            {...rest}
        >
            {children}
        </a>
    ),
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

// `LimitedVsAiPanel` renders for any started+pool-final event with a viewer
// seat — pull in its own mocking discipline (`limited-vs-ai-panel.test.tsx`)
// so a STARTED-status fixture here doesn't crash on a missing ConvexProvider.
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn(),
    useQuery: () => null,
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

// No saved decks: the hosted round action only needs the hook to resolve.
const userDecksMock: unknown[] = [];

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDecks: () => userDecksMock,
}));

const eventMock = vi.fn();

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEvent: () => eventMock(),
    usePackSources: () => [],
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
});

afterEach(() => {
    cleanup();
});

type Phase = "waiting" | "draft" | "deckbuilding" | "games" | "done";

const PAIRING = {
    roundNumber: 1,
    seatIndex: 0,
    opponentSeatIndex: 1,
    opponentNickname: "Bea",
    opponentIsBot: true,
    isBye: false,
    result: null,
    gameWins: null,
    gameLosses: null,
    outcome: null,
    matchId: null,
    roundComplete: false,
};

const PHASE_OVERRIDES: Record<Phase, Partial<LimitedEventView>> = {
    waiting: { status: "open" },
    draft: { status: "started", type: "draft" },
    deckbuilding: { status: "started" },
    games: {
        status: "playing",
        completed: true,
        currentRound: 1,
        viewerPairing: PAIRING,
    },
    done: { status: "finished", completed: true },
};

function makeEvent(
    phase: Phase,
    role: "creator" | "seated" | "visitor"
): LimitedEventView {
    const seated = role !== "visitor";
    return {
        _id: "event-1",
        createdBy: role === "creator" ? "user-1" : "admin-1",
        type: "sealed",
        status: "open",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        gamesFormat: "bo3",
        openDecklists: false,
        viewerIncomingChallenges: [],
        viewerOutgoingChallenge: null,
        packSlots: ["lea"],
        rounds: [],
        standings: [],
        viewerPairing: null,
        seats: seated
            ? [
                  {
                      seatIndex: 0,
                      userId: "user-1",
                      nickname: "Alice",
                      isBot: false,
                      isViewer: true,
                      hasDeck: false,
                      poolCount: null,
                      pool: null,
                      currentPack: null,
                      packQueueCount: null,
                      pickDeadline: null,
                      autoBuiltDeck: null,
                  },
              ]
            : [],
        createdAt: 0,
        updatedAt: 0,
        ...PHASE_OVERRIDES[phase],
    } as unknown as LimitedEventView;
}

const PHASES: Phase[] = ["waiting", "draft", "deckbuilding", "games", "done"];
const ROLES = ["creator", "seated", "visitor"] as const;

describe("LimitedEventDetail skeleton — one primary CTA per phase", () => {
    for (const phase of PHASES) {
        for (const role of ROLES) {
            it(`${phase} · ${role}: exactly one hero CTA and the stepper on ${phase}`, () => {
                eventMock.mockReturnValue(makeEvent(phase, role));
                render(<LimitedEventDetail eventId={"event-1" as never} />);

                expect(
                    document.querySelectorAll("[data-hero-cta]")
                ).toHaveLength(1);
                const current = screen
                    .getByTestId("event-stepper")
                    .querySelectorAll("[aria-current='step']");
                expect(current).toHaveLength(1);
                expect(current[0].getAttribute("data-step")).toBe(phase);
            });
        }
    }

    it("keeps destructive actions out of the page body — they appear only once the ⋯ menu is open", () => {
        eventMock.mockReturnValue(makeEvent("waiting", "creator"));
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        expect(screen.queryByText("Cancel Event")).toBeNull();
        expect(screen.queryByText("Share invite link")).toBeNull();

        fireEvent.click(screen.getByLabelText("Event actions"));
        const menu = screen.getByTestId("event-menu-list");
        expect(menu.textContent).toContain("Cancel Event");
        expect(menu.textContent).not.toContain("Leave");
        expect(menu.textContent).toContain("Share invite link");
        expect(screen.getByTestId("event-hero").textContent).not.toMatch(
            /Cancel Event/
        );
    });

    it("closes the menu on Escape", () => {
        eventMock.mockReturnValue(makeEvent("waiting", "creator"));
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        fireEvent.click(screen.getByLabelText("Event actions"));
        expect(screen.queryByTestId("event-menu-list")).not.toBeNull();
        fireEvent.keyDown(document, { key: "Escape" });
        expect(screen.queryByTestId("event-menu-list")).toBeNull();
    });

    it("shows the draft progress tile per pack and the viewer's picks while drafting", () => {
        eventMock.mockReturnValue(makeEvent("draft", "seated"));
        render(<LimitedEventDetail eventId={"event-1" as never} />);

        const tile = screen.getByTestId("draft-progress");
        expect(tile.querySelectorAll("[data-pack-state]")).toHaveLength(1);
        expect(tile.textContent).toContain("Your picks");
    });
});

describe("LimitedEventDetail — Review the table tab (issue #5392)", () => {
    for (const phase of ["waiting", "draft", "deckbuilding"] as const) {
        it(`${phase}: no tab bar`, () => {
            eventMock.mockReturnValue(makeEvent(phase, "seated"));
            render(<LimitedEventDetail eventId={"event-1" as never} />);
            expect(
                screen.queryByRole("tab", { name: "Review the table" })
            ).toBeNull();
        });
    }

    for (const phase of ["games", "done"] as const) {
        it(`${phase}: tab present and switches to the review`, () => {
            eventMock.mockReturnValue(makeEvent(phase, "seated"));
            render(<LimitedEventDetail eventId={"event-1" as never} />);
            expect(
                document.querySelector("[data-slot=event-table]")
            ).not.toBeNull();
            fireEvent.click(
                screen.getByRole("tab", { name: "Review the table" })
            );
            expect(
                document.querySelector("[data-slot=review-panel]")
            ).not.toBeNull();
            expect(
                document.querySelector("[data-slot=event-table]")
            ).toBeNull();
        });
    }
});
