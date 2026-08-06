// Column-drag PERSIST wiring (issue #1575 AC2): a column move in the limited
// deckbuilder resolves the cardId-keyed action back to a Pool `poolIndex` and
// persists it on the seat's Pool Arrangement through the SAME
// `setPoolArrangementEntry` mutation the draft Pool uses. The surface is
// stubbed to buttons that fire `onPin` directly so this file isolates the
// form → mutation seam; the REAL drag through the REAL surface lives in
// `deck-builder-shell.test.tsx`, and the pure resolution in
// `deckZoneDrag.test.ts`.
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

// Stub the SHELL (issue #1623 absorbed `pool-deckbuilder-surface` into it):
// expose the Pin callback as buttons so the form's handlers can be driven
// without a real drag (the REAL mounted drag lives in
// `deck-builder-shell.test.tsx`; this file proves the form → mutation seam).
// Ids are inlined (a vi.mock factory is hoisted above the top-level consts, so
// it can't close over them).
vi.mock("../deck-builder-shell", () => ({
    default: (props: {
        actions: {
            onPin: (cardId: string, columnId: string) => void;
            onMoveToMaindeck: (cardId: string) => void;
        };
    }) => (
        <div>
            <button
                onClick={() =>
                    props.actions.onPin(
                        "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
                        "mv:6"
                    )
                }
                type="button"
            >
                set-bolt-mv6
            </button>
            <button
                onClick={() =>
                    props.actions.onPin(
                        "eace2c85-976c-425e-9800-5a6ccbd91b56",
                        "mv:4"
                    )
                }
                type="button"
            >
                set-basic-mv4
            </button>
            <button
                onClick={() =>
                    props.actions.onPin(
                        "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
                        "custom:combo"
                    )
                }
                type="button"
            >
                set-bolt-custom
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

    // The mutation's wire vocabulary is still the legacy `column` (issue
    // #1621: only the PERSISTED shape moved), so a Pin in a namespace that
    // vocabulary cannot express must be dropped rather than sent as garbage.
    it("is a no-op for a Pin outside the mv namespace (no legacy column to send)", () => {
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
        fireEvent.click(getByText("set-bolt-custom"));
        expect(setColumnMock).not.toHaveBeenCalled();
    });
});
