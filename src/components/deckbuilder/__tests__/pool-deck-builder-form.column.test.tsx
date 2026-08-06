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
/** The slice of `DeckBuilderShellProps` this file's stub reads. `mainCards`
 *  is the form's REAL working Maindeck, each entry carrying the per-copy Pin
 *  key it was seeded with (issue #1626), which is what the stub pins by. */
interface ShellStubProps {
    actions: {
        onPin: (cardId: string, columnId: string, pinKey: string) => void;
        onMoveToMaindeck: (cardId: string) => void;
    };
    mainCards: { cardId: string; pinKey?: string }[];
}

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
//
// Each button reads its Pin key off the form's OWN working Maindeck entries
// (issue #1626) — never a hand-written key — so these assertions traverse the
// real per-copy identity the form seeded, instead of a fixture's idea of it.
// That is what makes "the second copy of a card pins independently" provable
// here rather than only in the pure helper's unit test.
vi.mock("../deck-builder-shell", () => {
    const pin = (
        props: ShellStubProps,
        cardId: string,
        columnId: string,
        copyIndex = 0
    ) => {
        const copy = props.mainCards.filter((c) => c.cardId === cardId)[
            copyIndex
        ];
        props.actions.onPin(cardId, columnId, copy?.pinKey ?? cardId);
    };
    return {
        default: (props: ShellStubProps) => (
            <div>
                <button
                    onClick={() =>
                        pin(
                            props,
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
                        pin(
                            props,
                            "d573ef03-4730-45aa-93dd-e45ac1dbaf4a",
                            "mv:2",
                            1
                        )
                    }
                    type="button"
                >
                    set-bolt-copy2-mv2
                </button>
                <button
                    onClick={() =>
                        pin(
                            props,
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
                        pin(
                            props,
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
                        pin(
                            props,
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
                        pin(
                            props,
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
                        pin(
                            props,
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
    };
});

import PoolDeckBuilderForm from "../pool-deck-builder-form";

// TWO Lightning Bolts on purpose (issue #1626): the Pool distinguishes its
// physical copies, so the two must be pinnable to different Columns.
const POOL = [
    { scryfallId: "s1", cardId: BOLT_ID, cardName: "Lightning Bolt" },
    { scryfallId: "s2", cardId: PLAINS_ID, cardName: "Plains" },
    { scryfallId: "s3", cardId: BOLT_ID, cardName: "Lightning Bolt" },
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

    // Issue #1626 AC: "in Limited, two copies of the same card can be pinned
    // to different columns". The pre-#1626 call site resolved a `cardId` back
    // to a poolIndex by GUESSING ("prefer a Maindeck copy, else any"), so the
    // second copy was unreachable and pinning either one moved the same
    // physical card.
    it("pins the SECOND copy of a card independently of the first", () => {
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
        fireEvent.click(getByText("set-bolt-copy2-mv2"));
        expect(setColumnMock).toHaveBeenCalledTimes(2);
        expect(setColumnMock).toHaveBeenNthCalledWith(1, {
            eventId: "event-1",
            poolIndex: 0, // the first Bolt
            column: "mv:6",
        });
        expect(setColumnMock).toHaveBeenNthCalledWith(2, {
            eventId: "event-1",
            poolIndex: 2, // the SECOND Bolt — a different physical card
            column: "mv:2",
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
