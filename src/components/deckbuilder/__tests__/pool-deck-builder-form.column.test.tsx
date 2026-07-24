// Column-drag PERSIST wiring (issue #1575 AC2): a column move in the limited
// deckbuilder resolves the cardId-keyed action back to a Pool `poolIndex` and
// persists it on the seat's Pool Arrangement through the SAME
// `setPoolArrangementEntry` mutation the draft Pool uses. The surface is
// stubbed to a button that fires `onSetColumn` directly (real dnd-kit drag
// can't be exercised in jsdom — the pure resolution lives in
// `deckbuilderColumnDrag.test.ts`), so this proves the form → mutation seam.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

const navigate = vi.fn();
const setColumnMock = vi.fn().mockResolvedValue(null);
const createMock = vi.fn().mockResolvedValue("deck-1");
const updateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => navigate,
}));

vi.mock("~/hooks/useLimitedEvent", () => ({
    useLimitedEventMutations: () => ({
        setPoolArrangementEntry: setColumnMock,
    }),
}));

vi.mock("~/hooks/useUserDecks", () => ({
    useUserDeckMutations: () => ({ create: createMock, update: updateMock }),
}));

const BOLT_ID = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a"; // Lightning Bolt
const PLAINS_ID = "b1623d57-4729-4796-b3f7-f1837a05c6ed"; // Plains

// Stub the surface: expose the two column callbacks as buttons so the form's
// handlers can be driven without a real drag. Ids are inlined (a vi.mock
// factory is hoisted above the top-level consts, so it can't close over them).
vi.mock("../pool-deckbuilder-surface", () => ({
    default: (props: {
        onSetColumn: (cardId: string, column: number | "lands") => void;
        onMoveToMaindeck: (cardId: string) => void;
    }) => (
        <div>
            <button
                onClick={() =>
                    props.onSetColumn(
                        "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
                        6
                    )
                }
                type="button"
            >
                set-bolt-mv6
            </button>
            <button
                onClick={() =>
                    props.onSetColumn(
                        "eace2c85-976c-425e-9800-5a6ccbd91b56",
                        4
                    )
                }
                type="button"
            >
                set-basic-mv4
            </button>
        </div>
    ),
}));

import PoolDeckBuilderForm from "../pool-deck-builder-form";

const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
];

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe("PoolDeckBuilderForm — column persist wiring (issue #1575)", () => {
    it("persists a column override on the seat's Pool Arrangement, resolving the cardId to its poolIndex", () => {
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        fireEvent.click(getByText("set-bolt-mv6"));
        expect(setColumnMock).toHaveBeenCalledTimes(1);
        expect(setColumnMock).toHaveBeenCalledWith({
            eventId: "event-1",
            poolIndex: 0, // Bolt's position in the Pool
            column: 6,
        });
    });

    it("is a no-op for a Basic land added from the bar (no poolIndex to override)", () => {
        const { getByText } = render(
            <PoolDeckBuilderForm
                eventId={"event-1" as never}
                seatIndex={0}
                pool={POOL}
                existingDeck={null}
                eventType="draft"
                poolArrangement={[]}
            />
        );
        fireEvent.click(getByText("set-basic-mv4"));
        expect(setColumnMock).not.toHaveBeenCalled();
    });
});
