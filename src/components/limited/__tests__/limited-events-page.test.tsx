// The Limited hub, `/limited` (PRD #5383, issue #5388): "Your events" tiles
// with one primary CTA per phase, the New event tile last, the zero-event
// "Start or join a table" shape, Join a table, status chips and History.
// Drives the REAL page component over the two mocked list queries (the slim
// summary views), mirroring `limited-vs-ai-panel.test.tsx`'s mocking
// discipline. `status` / `onStatusChange` are props (owned by
// `limited-events.route.tsx`'s `useSearch`/`useNavigate` wiring), so this file
// drives every filter without mocking `useSearch`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type {
    LimitedEventSummaryView,
    PackSourceInfo,
} from "~/hooks/useLimitedEvent";
import type { LimitedEventStatusChip } from "~/lib/limitedEventStatus";
import { LIMITED_SETUP_STORAGE_KEY } from "~/lib/limited/limitedSetup";
import LimitedEventsPage from "../limited-events-page";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: "user-1", nickname: "Alice" }),
}));

const openEventsMock = vi.fn();
const myEventsMock = vi.fn();
const createMock = vi.fn();

const cubeSet = {
    setCode: "vintage-cube",
    draftable: true,
    missingCardCount: 0,
    sheets: [],
    isCube: true,
    availableCardCount: 540,
};
const SOURCES: PackSourceInfo[] = [
    {
        key: "vintage-cube",
        name: "Vintage Cube",
        description: "",
        featureCardId: null,
        draftOnly: true,
        draftable: true,
        sets: [cubeSet],
    },
    {
        key: "lea",
        name: "Limited Edition Alpha",
        description: "",
        featureCardId: null,
        draftOnly: false,
        draftable: true,
        sets: [
            {
                setCode: "lea",
                draftable: true,
                missingCardCount: 0,
                sheets: [],
            },
        ],
    },
];

// `useJoinLimitedEvent` is deliberately left as the REAL implementation
// (`importOriginal`, issue #2648): it is plain React state over an injected
// mutation, not a Convex subscription, so it needs no mocking of its own.
vi.mock("~/hooks/useLimitedEvent", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("~/hooks/useLimitedEvent")>();
    return {
        ...actual,
        useOpenLimitedEvents: () => openEventsMock(),
        useMyLimitedEvents: () => myEventsMock(),
        usePackSources: () => SOURCES,
        useLimitedEventMutations: () => ({
            create: createMock,
            join: vi.fn(),
            start: vi.fn(),
        }),
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    openEventsMock.mockReturnValue([]);
    myEventsMock.mockReturnValue([]);
});

afterEach(() => {
    cleanup();
});

function seat(
    seatIndex: number,
    overrides: Partial<LimitedEventSummaryView["seats"][number]> = {}
): LimitedEventSummaryView["seats"][number] {
    return {
        seatIndex,
        isBot: false,
        isViewer: false,
        poolCount: null,
        hasDeck: false,
        ...overrides,
    };
}

/** An event the viewer sits in (seat 0) unless `seats` says otherwise. */
function makeEvent(
    overrides: Partial<LimitedEventSummaryView> = {}
): LimitedEventSummaryView {
    return {
        _id: "event-1",
        createdBy: "admin-1",
        type: "draft",
        status: "started",
        completed: false,
        seatCount: 2,
        seatsWithDeck: 0,
        packSlots: ["vintage-cube", "vintage-cube", "vintage-cube"],
        gamesFormat: "bo3",
        openDecklists: false,
        seats: [
            seat(0, { userId: "user-1", nickname: "Alice", isViewer: true }),
            seat(1, { isBot: true }),
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as LimitedEventSummaryView;
}

/** A table nobody-but-others sit at, with a free seat the viewer can take. */
function makeJoinable(
    overrides: Partial<LimitedEventSummaryView> = {}
): LimitedEventSummaryView {
    return makeEvent({
        _id: "event-open",
        status: "open",
        seats: [seat(0, { userId: "other", nickname: "Bob" }), seat(1)],
        ...overrides,
    });
}

const drafting = (id = "event-drafting") =>
    makeEvent({ _id: id, draftCompletedAt: undefined });
const building = (id = "event-building") =>
    makeEvent({ _id: id, draftCompletedAt: 1 });

function renderPage(
    props: Partial<{
        status: LimitedEventStatusChip | undefined;
        label: string | undefined;
        onStatusChange: (next: LimitedEventStatusChip | undefined) => void;
    }> = {}
) {
    return render(
        <LimitedEventsPage
            status={props.status}
            label={props.label}
            onStatusChange={props.onStatusChange ?? vi.fn()}
        />
    );
}

const ctas = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-hub-cta]"));
const tileKinds = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-hub-tile]")).map(
        (el) => el.dataset.hubTile
    );

describe("LimitedEventsPage — Your events", () => {
    it("lists only the viewer's in-progress events, with a count", () => {
        openEventsMock.mockReturnValue([makeJoinable()]);
        myEventsMock.mockReturnValue([
            drafting("event-mine"),
            makeEvent({ _id: "event-done", status: "finished" }),
        ]);

        renderPage();

        expect(
            screen.getByRole("heading", { name: "Your events (1)" })
        ).toBeTruthy();
        const events = document.querySelectorAll('[data-hub-tile="event"]');
        expect(events).toHaveLength(1);
        // The finished event is History's, the open table is Join a table's.
        expect(document.querySelector('[data-hub-tile="history"]')).toBeNull();
    });

    it("gives a waiting event one disabled CTA reading Waiting — n/m seats", () => {
        myEventsMock.mockReturnValue([
            makeEvent({
                status: "open",
                seatCount: 4,
                seats: [
                    seat(0, { userId: "user-1", isViewer: true }),
                    seat(1, { isBot: true }),
                    seat(2),
                    seat(3),
                ],
            }),
        ]);

        renderPage();

        expect(ctas()).toHaveLength(1);
        expect(ctas()[0].textContent).toBe("Waiting — 2/4 seats");
        expect((ctas()[0] as HTMLButtonElement).disabled).toBe(true);
    });

    it("drafting: Enter draft room opens the draft room", () => {
        myEventsMock.mockReturnValue([drafting()]);

        renderPage();

        expect(ctas()).toHaveLength(1);
        fireEvent.click(
            screen.getByRole("button", { name: "Enter draft room" })
        );
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId/draft",
            params: { eventId: "event-drafting" },
        });
    });

    it("building without a deck: Build your deck opens the deck builder", () => {
        myEventsMock.mockReturnValue([building()]);

        renderPage();

        expect(ctas()).toHaveLength(1);
        fireEvent.click(
            screen.getByRole("button", { name: "Build your deck" })
        );
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId/build",
            params: { eventId: "event-building" },
        });
    });

    it("building with the viewer's deck in: one disabled Waiting — n/m decks", () => {
        myEventsMock.mockReturnValue([
            makeEvent({
                draftCompletedAt: 1,
                seatsWithDeck: 1,
                seats: [
                    seat(0, {
                        userId: "user-1",
                        isViewer: true,
                        hasDeck: true,
                    }),
                    seat(1, { userId: "other" }),
                ],
            }),
        ]);

        renderPage();

        expect(ctas()).toHaveLength(1);
        expect(ctas()[0].textContent).toBe("Waiting — 1/2 decks");
        expect((ctas()[0] as HTMLButtonElement).disabled).toBe(true);
    });

    it("playing: Play round N counts the matches already on the viewer's record", () => {
        myEventsMock.mockReturnValue([
            makeEvent({
                status: "playing",
                draftCompletedAt: 1,
                completed: true,
                viewerMatchRecord: { wins: 1, losses: 1, draws: 0 },
            }),
        ]);

        renderPage();

        expect(ctas()).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "Play round 3" }));
        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
        });
    });

    it("puts the New event tile LAST, after every event tile", () => {
        myEventsMock.mockReturnValue([
            drafting("event-a"),
            building("event-b"),
        ]);

        renderPage();

        expect(tileKinds()).toEqual(["event", "event", "new-event"]);
    });

    it("navigates to the event detail page from a tile's View", () => {
        myEventsMock.mockReturnValue([drafting()]);

        renderPage();
        fireEvent.click(screen.getByText("View"));

        expect(navigate).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-drafting" },
        });
    });
});

describe("LimitedEventsPage — New event tile", () => {
    it("Again starts Draft · Vintage Cube on a first visit", async () => {
        createMock.mockResolvedValue("event-new");
        myEventsMock.mockReturnValue([drafting()]);

        renderPage();
        fireEvent.click(
            screen.getByRole("button", { name: "Again: your last event" })
        );

        await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
        expect(createMock.mock.calls[0][0]).toMatchObject({
            type: "draft",
            packSource: "vintage-cube",
            seatCount: 8,
        });
        await vi.waitFor(() =>
            expect(navigate).toHaveBeenCalledWith({
                to: "/limited/$eventId",
                params: { eventId: "event-new" },
            })
        );
    });

    it("Again reads the stored last setup", async () => {
        window.localStorage.setItem(
            LIMITED_SETUP_STORAGE_KEY,
            JSON.stringify({
                type: "sealed",
                packSource: "lea",
                seats: 4,
                gamesFormat: 1,
                pickTimer: false,
                boostersPerSeat: 6,
                roundDeadlineMinutes: null,
                openDecklists: false,
            })
        );
        createMock.mockResolvedValue("event-new");
        myEventsMock.mockReturnValue([drafting()]);

        renderPage();
        expect(
            screen.getByText("Sealed · Limited Edition Alpha · 4 seats")
        ).toBeTruthy();
        fireEvent.click(
            screen.getByRole("button", { name: "Again: your last event" })
        );

        await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
        expect(createMock.mock.calls[0][0]).toMatchObject({
            type: "sealed",
            packSource: "lea",
            seatCount: 4,
        });
    });

    it("opens /limited/new from Choose format, seats, timers…", () => {
        myEventsMock.mockReturnValue([drafting()]);

        renderPage();
        fireEvent.click(
            screen.getByRole("button", {
                name: "Choose format, seats, timers…",
            })
        );

        expect(navigate).toHaveBeenCalledWith({ to: "/limited/new" });
    });
});

describe("LimitedEventsPage — no event in progress", () => {
    it("puts the New event tile beside the joinable tables under Start or join a table", () => {
        openEventsMock.mockReturnValue([makeJoinable()]);

        renderPage();

        expect(
            screen.getByRole("heading", { name: "Start or join a table" })
        ).toBeTruthy();
        expect(screen.queryByText(/Your events/)).toBeNull();
        expect(tileKinds()).toEqual(["new-event"]);
        expect(screen.getByText("Waiting for players")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Join" })).toBeTruthy();
    });

    it("says so when no table is open", () => {
        renderPage();

        expect(screen.getByText("No open tables right now.")).toBeTruthy();
        expect(tileKinds()).toEqual(["new-event"]);
    });
});

describe("LimitedEventsPage — Join a table", () => {
    it("lists a joinable table with its free seats beneath the viewer's events", () => {
        openEventsMock.mockReturnValue([makeJoinable()]);
        myEventsMock.mockReturnValue([drafting()]);

        renderPage();

        expect(
            screen.getByRole("heading", { name: "Join a table" })
        ).toBeTruthy();
        expect(screen.getByText(/1 free seat/)).toBeTruthy();
    });

    it("de-duplicates an event present in BOTH queries", () => {
        openEventsMock.mockReturnValue([drafting("event-both")]);
        myEventsMock.mockReturnValue([drafting("event-both")]);

        renderPage();

        expect(
            document.querySelectorAll('[data-hub-tile="event"]')
        ).toHaveLength(1);
    });
});

describe("LimitedEventsPage — chips, History", () => {
    it("shows a count on each status chip", () => {
        openEventsMock.mockReturnValue([makeJoinable()]);
        myEventsMock.mockReturnValue([
            drafting(),
            building(),
            makeEvent({ _id: "event-done", status: "finished" }),
        ]);

        renderPage();

        expect(screen.getByRole("button", { name: "Waiting 1" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Drafting 1" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Building 1" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Playing 0" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "History 1" })).toBeTruthy();
    });

    it("status=drafting narrows both live sections to that phase", () => {
        myEventsMock.mockReturnValue([drafting(), building()]);

        renderPage({ status: "drafting" });

        expect(
            document.querySelectorAll('[data-hub-tile="event"]')
        ).toHaveLength(1);
        expect(ctas()[0].textContent).toBe("Enter draft room");
    });

    it("status=history shows the finished events, and only there", () => {
        myEventsMock.mockReturnValue([
            drafting(),
            makeEvent({
                _id: "event-done",
                status: "finished",
                viewerMatchRecord: { wins: 3, losses: 1, draws: 0 },
            }),
        ]);

        renderPage({ status: "history" });

        expect(
            screen.getByRole("heading", { name: "History (1)" })
        ).toBeTruthy();
        expect(tileKinds()).toEqual(["history"]);
        expect(screen.getByText(/3-1/)).toBeTruthy();
    });

    it("keeps finished events off the hub, behind a Recent results link into History", () => {
        const onStatusChange = vi.fn();
        myEventsMock.mockReturnValue([
            drafting(),
            makeEvent({ _id: "event-done", status: "finished" }),
        ]);

        renderPage({ onStatusChange });

        expect(document.querySelector('[data-hub-tile="history"]')).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "View history" }));
        expect(onStatusChange).toHaveBeenCalledWith("history");
    });

    it("has no Mine filter any more", () => {
        renderPage();

        expect(screen.queryByRole("button", { name: "Mine" })).toBeNull();
    });

    it("calls onStatusChange with the chip value when a status chip is pressed", () => {
        const onStatusChange = vi.fn();

        renderPage({ onStatusChange });
        fireEvent.click(screen.getByRole("button", { name: "Playing 0" }));

        expect(onStatusChange).toHaveBeenCalledWith("playing");
    });

    it("calls onStatusChange with undefined when the ACTIVE chip is pressed again", () => {
        const onStatusChange = vi.fn();

        renderPage({ status: "playing", onStatusChange });
        fireEvent.click(screen.getByRole("button", { name: "Playing 0" }));

        expect(onStatusChange).toHaveBeenCalledWith(undefined);
    });
});

// The fixture-label filter (issue #2822). `listOpenLimitedEvents` returns
// every open event on the deployment to EVERYONE, so "give the check:ui lane
// its own account" does not bound this page — the `?label=` prefix filter
// does. A filter that silently stopped narrowing (or narrowed on equality
// instead of prefix, which would hide half the fixture) goes red here.
describe("LimitedEventsPage — fixture label filter (issue #2822)", () => {
    const fixtureEvents = () => [
        makeEvent({ _id: "f-draft", label: "ui-gate/draft" }),
        makeEvent({
            _id: "f-build",
            label: "ui-gate/build",
            draftCompletedAt: 1,
        }),
        makeEvent({ _id: "real" }),
    ];

    it("narrows the hub to the seeded fixture, excluding the deployment's own events", () => {
        myEventsMock.mockReturnValue(fixtureEvents());

        renderPage({ label: "ui-gate/" });

        expect(
            document.querySelectorAll('[data-hub-tile="event"]')
        ).toHaveLength(2);
    });

    it("addresses exactly one fixture tile when given a full label", () => {
        myEventsMock.mockReturnValue(fixtureEvents());

        renderPage({ label: "ui-gate/draft" });

        const tiles = document.querySelectorAll("[data-limited-event-label]");
        expect(tiles).toHaveLength(1);
        expect(tiles[0].getAttribute("data-limited-event-label")).toBe(
            "ui-gate/draft"
        );
    });

    it("leaves the hub unfiltered when no label is given", () => {
        myEventsMock.mockReturnValue(fixtureEvents());

        renderPage();

        expect(
            document.querySelectorAll('[data-hub-tile="event"]')
        ).toHaveLength(3);
    });
});
