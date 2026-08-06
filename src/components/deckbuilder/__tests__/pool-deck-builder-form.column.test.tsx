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
            <button
                onClick={() =>
                    props.actions.onPin(
                        "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
                        "color:R"
                    )
                }
                type="button"
            >
                set-bolt-color
            </button>
            <button
                onClick={() =>
                    props.actions.onPin(
                        "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
                        "type:instant"
                    )
                }
                type="button"
            >
                set-bolt-type
            </button>
            <button
                onClick={() =>
                    props.actions.onPin(
                        "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
                        "catch-all"
                    )
                }
                type="button"
            >
                set-bolt-catch-all
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
            // The namespaced Column id travels WHOLE since issue #1624 — it
            // is no longer squeezed back through the mv-only legacy shim.
            column: "mv:6",
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

    // Issue #1624 regression: the per-zone Grouping control makes colour and
    // type Columns reachable, and the Maindeck is `dropModel: "columns"`, so
    // each of them is a live drop target. Before this fix the call site
    // funnelled the dropped Column id through the mv-only shim
    // (`mvColumnFromPins`), which returns `undefined` for every other
    // namespace — the mutation was never called and the drag was silently
    // dead.
    it.each([
        ["set-bolt-color", "color:R"],
        ["set-bolt-type", "type:instant"],
        ["set-bolt-custom", "custom:combo"],
    ])(
        "persists a Pin outside the mv namespace (%s) with its Column id intact",
        (button, columnId) => {
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
            fireEvent.click(getByText(button));
            expect(setColumnMock).toHaveBeenCalledTimes(1);
            expect(setColumnMock).toHaveBeenCalledWith({
                eventId: "event-1",
                poolIndex: 0,
                column: columnId,
            });
        }
    );

    // The Catch-All carries no namespace, so it is not a pin target — the
    // same rule the engine's own `pinCardToColumn` applies. Nothing is sent
    // rather than a garbage id the server would have to no-op on.
    it("is a no-op for an unnamespaced Column id (the Catch-All is never a pin target)", () => {
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
        fireEvent.click(getByText("set-bolt-catch-all"));
        expect(setColumnMock).not.toHaveBeenCalled();
    });
});
