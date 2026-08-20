// The Draft Room's own route (issue #2587, PRD #2405 slice 8, ADR 0101 §6).
//
// Every assertion here runs the fixture through the REAL projection
// (`projectLimitedEvent`) and the REAL room, never a hand-built view: the room
// reads `currentPack` / `pool` / `packQueueCount` / `poolCount`, all of which
// are per-seat STRIPPED on the way out (`convex/limited/eventProjection.ts`),
// and a hand-built seat would hide exactly the drop this file exists to catch
// (`.claude/rules/gre-development.md` § Frontend wiring analysis).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import LimitedDraftRoom from "../limited-draft-room";

vi.mock("motion/react", () => ({
    useReducedMotion: () => false,
}));

// Driven explicitly (pattern shared with `controller-portrait.test.tsx`)
// rather than trusting happy-dom's `matchMedia` — the hook's own SSR/no-
// `matchMedia` fallback already defaults to "desktop", which is what every
// pre-existing test in this file implicitly relied on before this mock
// existed; only the orientation-hint tests below override it.
let viewportMode: "portrait" | "landscape-compact" | "desktop" = "desktop";
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => viewportMode,
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
    useCurrentUser: () => ({ _id: "user1", nickname: "Alice" }),
}));

vi.mock("convex/react", () => ({
    useMutation: () => vi.fn().mockResolvedValue(null),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

const eventMock = vi.fn();

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEvent: () => eventMock(),
    useLimitedEventMutations: () => ({
        submitPick: vi.fn().mockResolvedValue(null),
        selectDraftPick: vi.fn().mockResolvedValue(null),
        setPoolArrangementEntry: vi.fn().mockResolvedValue(null),
    }),
}));

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

beforeEach(() => {
    vi.clearAllMocks();
    viewportMode = "desktop";
    sessionStorage.clear();
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function draftRow(overrides: Partial<LimitedEventRow> = {}): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        draftRound: 0,
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: [
                    {
                        scryfallId: "s-old",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                    },
                ],
                currentPack: [
                    {
                        scryfallId: "s1",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                        pickId: "r0-p0-c0",
                    },
                    {
                        scryfallId: "s2",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                        pickId: "r0-p0-c1",
                    },
                ],
                packQueue: [[]],
            },
            { seatIndex: 1, isBot: true, nickname: "Bot 2", pool: [] },
        ],
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    };
}

/** The projection is the seam: what the room gets is what the wire carries. */
function mountRoom(row: LimitedEventRow) {
    eventMock.mockReturnValue(projectLimitedEvent(row, "user1"));
    return render(<LimitedDraftRoom eventId={"event-1" as never} />);
}

describe("LimitedDraftRoom — the room replaces the in-page pick screen (issue #2587)", () => {
    it("renders the pack and the thin bar's counters, with no shell exit of its own", () => {
        mountRoom(draftRow());

        // The pack itself, through the projection.
        expect(
            document.querySelectorAll(
                "[role=button][aria-label^='Draft pick:']"
            ).length
        ).toBe(2);

        const bar = document.querySelector("[data-slot=draft-room-bar]")!;
        expect(bar).toBeTruthy();
        expect(bar.querySelector("[data-slot=pack-counter]")!.textContent).toBe(
            "Pack 1/3"
        );
        // One card already in the pool ⇒ this is pick #2, with 2 cards left.
        expect(bar.querySelector("[data-slot=pick-counter]")!.textContent).toBe(
            "Pick #2 · 2 left"
        );
        // Round 0 passes left (`passDirection`, the server's own function).
        expect(
            bar.querySelector("[data-slot=pass-direction]")!.textContent
        ).toContain("left");

        // ADR 0101 §6: no Event back-link while a pick is pending. Leaving is
        // in the overflow, which is closed.
        expect(screen.queryByText(/Back to Limited Events/)).toBeNull();
        expect(screen.queryByText("Leave the draft")).toBeNull();
        expect(screen.getByLabelText("More")).toBeTruthy();
    });

    it("shows the waiting-pack dot instead of a pick count when the seat holds no pack", () => {
        const row = draftRow();
        row.seats[0].currentPack = [];
        row.seats[0].packQueue = [];
        mountRoom(row);

        const bar = document.querySelector("[data-slot=draft-room-bar]")!;
        expect(bar.querySelector("[data-slot=waiting-pack]")!.textContent).toBe(
            "Waiting for a pack"
        );
    });

    it("opens the Table Ring from the bar", () => {
        mountRoom(draftRow());

        expect(document.querySelector("[data-slot=table-ring]")).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Table" }));
        expect(document.querySelector("[data-slot=table-ring]")).toBeTruthy();
    });

    it("unmounts the Pool pane when the bar's pool toggle is switched off", () => {
        mountRoom(draftRow());

        expect(screen.getByText(/Your Pool \(1\)/)).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "Pool" }));
        expect(screen.queryByText(/Your Pool \(1\)/)).toBeNull();
    });

    it("opens a SEALED event in reveal mode — no pack counters, the dealt Pool, the way into the builder", () => {
        mountRoom(
            draftRow({
                type: "sealed",
                packSlots: ["lea"],
                draftRound: undefined,
            })
        );

        const bar = document.querySelector("[data-slot=draft-room-bar]")!;
        expect(bar.querySelector("[data-slot=pack-counter]")).toBeNull();
        expect(bar.querySelector("[data-slot=pass-direction]")).toBeNull();
        expect(screen.getByText(/Your Sealed Pool \(1\)/)).toBeTruthy();
        expect(screen.getByText(/Build your deck/)).toBeTruthy();
        expect(navigateMock).not.toHaveBeenCalled();
    });

    it("resolves the layout regime for the table — one branch, three arrangements (issue #2588)", () => {
        // Issue #2587 shipped this as a binary (desktop split vs
        // everything-else stacked), which folded the two phone regimes
        // together. This is the assertion that they are no longer the same
        // arrangement.
        mountRoom(draftRow());
        expect(document.querySelector("[data-slot=draft-split]")).toBeTruthy();
        expect(
            document.querySelector("[data-slot=draft-snap-scroller]")
        ).toBeNull();

        cleanup();
        viewportMode = "portrait";
        mountRoom(draftRow());
        expect(
            document
                .querySelector("[data-slot=draft-snap-scroller]")!
                .getAttribute("data-orientation")
        ).toBe("portrait");
        expect(document.querySelector("[data-slot=draft-split]")).toBeNull();

        cleanup();
        viewportMode = "landscape-compact";
        mountRoom(draftRow());
        expect(
            document
                .querySelector("[data-slot=draft-snap-scroller]")!
                .getAttribute("data-orientation")
        ).toBe("landscape");
    });

    it("gives the phone body a FIXED box, not a scroller — a snap pane needs a definite height", () => {
        // A pane that is 85% of a container which is free to grow is 85% of
        // nothing. The desktop body keeps the scroller issue #2587 gave it.
        viewportMode = "portrait";
        const { container } = mountRoom(draftRow());
        const body = container.querySelector("[data-slot=draft-room-body]")!;
        expect(body.className).toContain("overflow-hidden");
        expect(body.className).not.toContain("overflow-y-auto");

        cleanup();
        viewportMode = "desktop";
        const desktop = mountRoom(draftRow());
        const desktopBody = desktop.container.querySelector(
            "[data-slot=draft-room-body]"
        )!;
        expect(desktopBody.className).toContain("overflow-y-auto");
    });

    it("leaves for the event page once the draft is over — the builder is what comes next, not an empty room", () => {
        mountRoom(draftRow({ draftCompletedAt: 1234 }));

        expect(navigateMock).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
            replace: true,
        });
    });

    it("leaves for the event page when the viewer holds no seat", () => {
        const row = draftRow();
        row.seats[0].userId = "someone-else";
        eventMock.mockReturnValue(projectLimitedEvent(row, "user1"));

        render(<LimitedDraftRoom eventId={"event-1" as never} />);

        expect(navigateMock).toHaveBeenCalledWith({
            to: "/limited/$eventId",
            params: { eventId: "event-1" },
            replace: true,
        });
    });
});

describe("LimitedDraftRoom — OrientationHint mount (issue #2594, round-3 review on PR #2645)", () => {
    // The rebase onto #2646 silently dropped this mount (it used to live in
    // `limited-event-detail.tsx`, superseded by this component), and NEITHER
    // Draft Room mount nor the board's was ever guarded by a test that
    // renders the real surface — see `game.route.orientation-hint.test.tsx`
    // for the sibling guard and the proof-of-failure receipt in the PR body.
    it("shows the draft-room hint in portrait while a pack is live", () => {
        viewportMode = "portrait";
        mountRoom(draftRow());

        expect(
            document.querySelector('[data-orientation-hint="draft-room"]')
        ).toBeTruthy();
    });

    it("does NOT show the hint on desktop", () => {
        viewportMode = "desktop";
        mountRoom(draftRow());

        expect(
            document.querySelector('[data-orientation-hint="draft-room"]')
        ).toBeFalsy();
    });
});
