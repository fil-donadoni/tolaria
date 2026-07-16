// Draft pick gestures through the REAL projection (ADR 0060, issue #1248,
// seam 3). Drives `LimitedDraftTable` from a `limitedEvents` row through
// `projectLimitedEvent` — the same wire the client actually receives (per
// `.claude/rules/gre-development.md`'s "Frontend wiring analysis": a
// hand-built view masks a dropped field). Proves: single click selects and
// NEVER commits; double click / the context-menu commit; "Pick to
// sideboard" composes submitPick + setPoolArrangementEntry with the
// resolved poolIndex; a selected card renders highlighted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "@convex/limited/eventProjection";
import LimitedDraftTable from "../limited-draft-table";

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt

const submitPickMock = vi.fn().mockResolvedValue(null);
const setPoolArrangementEntryMock = vi.fn().mockResolvedValue(null);
const selectDraftPickMock = vi.fn().mockResolvedValue(null);
const useMutationMock = vi.fn();

vi.mock("convex/react", () => ({
    useMutation: (...args: unknown[]) => useMutationMock(...args),
}));

vi.mock("@convex/_generated/api", () => ({
    api: {
        limitedEvents: {
            createLimitedEvent: "createLimitedEvent",
            joinLimitedEvent: "joinLimitedEvent",
            startLimitedEvent: "startLimitedEvent",
            submitPick: "submitPick",
            setPoolArrangementEntry: "setPoolArrangementEntry",
            selectDraftPick: "selectDraftPick",
        },
    },
}));

beforeEach(() => {
    vi.clearAllMocks();
    submitPickMock.mockResolvedValue(null);
    setPoolArrangementEntryMock.mockResolvedValue(null);
    selectDraftPickMock.mockResolvedValue(null);
    useMutationMock.mockImplementation((ref: string) => {
        switch (ref) {
            case "submitPick":
                return submitPickMock;
            case "setPoolArrangementEntry":
                return setPoolArrangementEntryMock;
            case "selectDraftPick":
                return selectDraftPickMock;
            default:
                return vi.fn().mockResolvedValue(null);
        }
    });
});

afterEach(() => cleanup());

function eventRow(overrides: {
    selectedPickId?: string;
    poolLength?: number;
}): LimitedEventRow {
    const poolLength = overrides.poolLength ?? 0;
    return {
        _id: "event-1",
        createdBy: "admin1",
        type: "draft",
        status: "started",
        seatCount: 2,
        packSlots: ["lea", "lea", "lea"],
        seats: [
            {
                seatIndex: 0,
                userId: "user1",
                nickname: "Alice",
                pool: Array.from({ length: poolLength }, (_, i) => ({
                    scryfallId: `s-existing-${i}`,
                    cardId: BOLT_ID,
                    cardName: "Lightning Bolt",
                })),
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
                selectedPickId: overrides.selectedPickId,
            },
            { seatIndex: 1, isBot: true },
        ],
        createdAt: 0,
        updatedAt: 0,
    };
}

function renderTable(overrides: {
    selectedPickId?: string;
    poolLength?: number;
}) {
    const view = projectLimitedEvent(eventRow(overrides), "user1");
    const seat = view.seats.find((s) => s.seatIndex === 0)!;
    // `projectLimitedEvent`'s pure return type has no `autoBuiltDeck` — that
    // field is zipped in separately by `projectEventForViewer`
    // (`convex/limitedEvents.ts`) and only exists on the real wire type
    // (`LimitedEventSeatView`, from the generated query). Stub it so the
    // fixture satisfies `LimitedDraftTable`'s prop type without pulling in
    // the whole Convex query machinery just for this seam-3 test.
    const seatView = { ...seat, autoBuiltDeck: null };
    return render(
        <LimitedDraftTable
            eventId={"event-1" as never}
            seat={seatView}
            round={0}
            totalRounds={3}
        />
    );
}

describe("LimitedDraftTable pick gestures through projectLimitedEvent (ADR 0060, issue #1248)", () => {
    it("a single click on a Booster card SELECTS it and never commits", () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.click(cards[0]);
        expect(selectDraftPickMock).toHaveBeenCalledWith({
            eventId: "event-1",
            pickId: "r0-p0-c0",
        });
        expect(submitPickMock).not.toHaveBeenCalled();
    });

    it("a double click on a Booster card commits the Pick", async () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.doubleClick(cards[0]);
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
    });

    it("the seat's selectedPickId (through the real projection) renders that exact card highlighted", () => {
        const { getAllByRole } = renderTable({ selectedPickId: "r0-p0-c1" });
        const cards = getAllByRole("button", { name: /Draft pick/ });
        const pressedStates = cards.map((c) => c.getAttribute("aria-pressed"));
        expect(pressedStates.filter((p) => p === "true")).toHaveLength(1);
    });

    it('the context menu\'s "Pick" commits the Pick', async () => {
        const { getAllByRole, getByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        fireEvent.click(getByRole("menuitem", { name: "Pick" }));
        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
    });

    it('the context menu\'s "Pick to sideboard" commits the Pick AND sideboards the new Pool card at the resolved poolIndex', async () => {
        // The seat already has 3 Pool cards — the new pick lands at index 3.
        const { getAllByRole, getByRole } = renderTable({ poolLength: 3 });
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        fireEvent.click(getByRole("menuitem", { name: "Pick to sideboard" }));

        await waitFor(() =>
            expect(submitPickMock).toHaveBeenCalledWith({
                eventId: "event-1",
                pickId: "r0-p0-c0",
            })
        );
        await waitFor(() =>
            expect(setPoolArrangementEntryMock).toHaveBeenCalledWith({
                eventId: "event-1",
                poolIndex: 3,
                sideboard: true,
            })
        );
    });

    it("a right click never selects or commits by itself — only opens the menu", () => {
        const { getAllByRole } = renderTable({});
        const cards = getAllByRole("button", { name: /Draft pick/ });
        fireEvent.contextMenu(cards[0]);
        expect(selectDraftPickMock).not.toHaveBeenCalled();
        expect(submitPickMock).not.toHaveBeenCalled();
    });
});
