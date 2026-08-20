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
});

afterEach(() => cleanup());

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
