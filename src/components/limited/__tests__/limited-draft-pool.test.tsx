// Draft-time Pool surface tests (ADR 0060, issue #1247, seam 3). Drives
// `LimitedDraftPool` THROUGH the real reducer — `projectLimitedEvent`
// (`convex/limited/eventProjection.ts`), the same privacy-projection seam
// the client actually receives (per `.claude/rules/gre-development.md`'s
// "Frontend wiring analysis": a hand-built view/state masks a dropped
// field, so it doesn't count). Proves: (1) the old flat text list is gone —
// the shared deckbuilder surface (images, MV columns, Sideboard column)
// renders instead; (2) a card's Pool Arrangement placement (sideboard
// membership) survives the real projection and is honoured by the surface;
// (3) a Pool⇄Sideboard move fires `setPoolArrangementEntry` with the
// poolIndex resolved from the projected pool + arrangement, not a
// hand-picked index.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import LimitedDraftPool from "../limited-draft-pool";

const setPoolArrangementEntryMock = vi.fn().mockResolvedValue(null);
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => {
    const apiProxy: unknown = new Proxy({}, { get: () => apiProxy });
    return { api: apiProxy };
});

beforeEach(() => {
    vi.clearAllMocks();
    setPoolArrangementEntryMock.mockResolvedValue(null);
    useMutationMock.mockReturnValue(setPoolArrangementEntryMock);
});

afterEach(() => {
    cleanup();
});

// Real registry ids — the shared surface's `groupDeckIntoPiles` resolves
// each card via the card registry, so synthetic ids would throw.
const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt (MV 1)
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains (land)

function eventRow(
    poolArrangement?: LimitedEventRow["seats"][number]["poolArrangement"]
): LimitedEventRow {
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        draftCompletedAt: 1,
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: [
                    {
                        scryfallId: "s-bolt-1",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                    },
                    {
                        scryfallId: "s-bolt-2",
                        cardId: BOLT_ID,
                        cardName: "Lightning Bolt",
                    },
                    {
                        scryfallId: "s-plains",
                        cardId: PLAINS_ID,
                        cardName: "Plains",
                    },
                ],
                poolArrangement,
            },
            { seatIndex: 1, isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

describe("LimitedDraftPool through projectLimitedEvent (ADR 0060, issue #1247)", () => {
    it("renders the shared deckbuilder surface (MV columns, Sideboard column) — the old flat text list is gone", () => {
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getByText, queryByText } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        // The shared surface's own headers (mana-value pile label + the
        // Sideboard column), not the old `LimitedPoolView` "N cards opened"
        // flat-list copy.
        expect(getByText("MV 1")).toBeTruthy();
        expect(getByText("Lands")).toBeTruthy();
        expect(getByText(/^Sideboard/)).toBeTruthy();
        expect(queryByText(/cards? opened/)).toBeNull();
    });

    it("with no Arrangement recorded, every card defaults to the Pool/Maindeck side — continuous draft→build, not the old all-Sideboard start", () => {
        const view = projectLimitedEvent(eventRow(undefined), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.poolArrangement).toBeNull();

        const { getByText } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
        expect(getByText(/^Pool 3/)).toBeTruthy();
        expect(getByText(/^Sideboard 0/)).toBeTruthy();
    });

    it("a card's Arrangement sideboard flag survives the real projection and renders in the Sideboard column", () => {
        const view = projectLimitedEvent(
            eventRow([{ poolIndex: 2, sideboard: true }]), // the Plains
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.poolArrangement).toEqual([{ poolIndex: 2, sideboard: true }]);

        const { getByText } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );
        expect(getByText(/^Pool 2/)).toBeTruthy();
        expect(getByText(/^Sideboard 1/)).toBeTruthy();
    });

    it("moving a Pool card to the Sideboard resolves poolIndex from the PROJECTED pool + Arrangement and persists via setPoolArrangementEntry", () => {
        const view = projectLimitedEvent(
            eventRow([{ poolIndex: 0, sideboard: true }]), // first Bolt already sideboarded
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getAllByTitle } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        // Two "Lightning Bolt" tiles now exist — one in the Pool column
        // (poolIndex 1, still main-side) and one in the Sideboard column
        // (poolIndex 0, already moved). The surface renders the Pool/Main
        // zone FIRST (left column), so index 0 is the movable one.
        const bolts = getAllByTitle(/Remove Lightning Bolt/);
        expect(bolts).toHaveLength(2);
        fireEvent.click(bolts[0]);
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 1,
            sideboard: true,
        });
    });

    it("moving a Sideboard card back to the Pool persists sideboard: false at its resolved poolIndex", () => {
        const view = projectLimitedEvent(
            eventRow([{ poolIndex: 2, sideboard: true }]), // Plains sideboarded
            "user1"
        );
        const own = view.seats.find((s) => s.seatIndex === 0)!;

        const { getByTitle } = render(
            <LimitedDraftPool
                eventId={"event-1" as never}
                pool={own.pool!}
                arrangement={own.poolArrangement}
            />
        );

        fireEvent.click(getByTitle(/Remove Plains/));
        expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 2,
            sideboard: false,
        });
    });
});
