// The Draft's table intro (issue #9167): the room shows the seat ring and the
// countdown instead of the pack, and Space fires "Start now" for the creator.
// The fixture goes through the REAL projection (`draftStartsAt` must survive
// it) and the REAL room, as `limited-draft-room.test.tsx` does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import LimitedDraftRoom from "../limited-draft-room";

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
let userId = "user1";
vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => ({ _id: userId, nickname: "Alice" }),
}));
vi.mock("convex/react", () => ({
    useMutation: () => vi.fn().mockResolvedValue(null),
}));
vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

const eventMock = vi.fn();
const startDraftNow = vi.fn().mockResolvedValue(null);
vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEvent: () => eventMock(),
    useLimitedEventMutations: () => ({
        startDraftNow,
        submitPick: vi.fn(),
        selectDraftPick: vi.fn(),
        setPoolArrangementEntry: vi.fn(),
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    userId = "user1";
    sessionStorage.clear();
});
afterEach(cleanup);

function introRow(): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "user1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        draftStartsAt: Date.now() + 12_000,
        seats: [
            { seatIndex: 0, userId: "user1", nickname: "Alice" },
            { seatIndex: 1, isBot: true, nickname: "Bot 2" },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

function mountRoom(row: LimitedEventRow) {
    eventMock.mockReturnValue(projectLimitedEvent(row, "user1"));
    return render(<LimitedDraftRoom eventId={"event-1" as never} />);
}

describe("Draft table intro (issue #9167)", () => {
    it("shows the ring and the countdown instead of a pack", () => {
        mountRoom(introRow());
        expect(document.querySelector("[data-slot=draft-intro]")).toBeTruthy();
        expect(document.querySelector("[data-slot=table-ring]")).toBeTruthy();
        expect(
            document.querySelector("[data-slot=draft-intro-countdown]")!
                .textContent
        ).toContain("12");
        expect(
            document.querySelectorAll("[aria-label^='Draft pick:']").length
        ).toBe(0);
    });

    it("Space triggers Start now, once per press", () => {
        mountRoom(introRow());
        fireEvent.keyDown(window, { code: "Space", key: " " });
        expect(startDraftNow).toHaveBeenCalledTimes(1);
        expect(startDraftNow).toHaveBeenCalledWith({ eventId: "event-1" });
    });

    it("the Start now button fires the same mutation", () => {
        mountRoom(introRow());
        fireEvent.click(screen.getByRole("button", { name: /Start now/ }));
        expect(startDraftNow).toHaveBeenCalledTimes(1);
    });

    it("a guest has no Start now and Space does nothing", () => {
        userId = "user2";
        const row = introRow();
        row.seats[1] = { seatIndex: 1, userId: "user2", nickname: "Bob" };
        eventMock.mockReturnValue(projectLimitedEvent(row, "user2"));
        render(<LimitedDraftRoom eventId={"event-1" as never} />);
        expect(screen.queryByRole("button", { name: /Start now/ })).toBeNull();
        fireEvent.keyDown(window, { code: "Space", key: " " });
        expect(startDraftNow).not.toHaveBeenCalled();
    });

    it("once round 0 is dealt the intro is gone", () => {
        const row = introRow();
        row.draftRound = 0;
        mountRoom(row);
        expect(document.querySelector("[data-slot=draft-intro]")).toBeNull();
    });
});
