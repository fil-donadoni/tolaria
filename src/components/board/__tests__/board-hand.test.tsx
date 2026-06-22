// #271 fix 2 — the viewer's hand reorders (view-only) when a card is dragged
// sideways, snapping it to the slot under the drop position. These tests drive
// the real BoardHand: leaf cards are inert markers that expose their
// onDragMove callback, and slot rects are stubbed so reorderIndexForDragX has
// real geometry to snap against. The order is asserted via the rendered slot
// DOM order, and the resync-to-server behavior is checked on a hand change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { CardInstance, Player } from "~/types/game";

const ZONE_W = 1000;
const ZONE_H = 300;
vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: ZONE_W, height: ZONE_H },
    }),
}));

// Capture each interactive hand card's onDragMove so the test can fire a drag
// reorder without a full pointer simulation. The marker carries its card id.
const dragMoves = new Map<string, (x: number) => void>();
vi.mock("../board-hand-card", () => ({
    default: ({
        card,
        onDragMove,
    }: {
        card: CardInstance;
        onDragMove?: (x: number) => void;
    }) => {
        if (onDragMove) dragMoves.set(card.id, onDragMove);
        return <div data-testid="hand-card" data-card-id={card.id} />;
    },
}));
vi.mock("../board-card", () => ({
    default: ({ card }: { card: CardInstance | null }) => (
        <div data-testid="bn-card" data-card-id={card ? card.id : "back"} />
    ),
}));

import BoardHand from "../board-hand";
import { fanLayout } from "~/lib/board-layout";

function handLayout(count: number, width: number, height: number) {
    return fanLayout({ count, width, baseY: height * 0.6 });
}

function card(id: string): CardInstance {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "hand",
        isTapped: false,
        legalActions: ["cast"],
    };
}

function makePlayer(ids: string[]): Player {
    return {
        id: "me",
        name: "Me",
        life: 20,
        hand: ids.map(card),
        battlefield: [],
        graveyard: [],
        exile: [],
        library: { count: 0 },
    } as unknown as Player;
}

/** Stub each rendered slot's client rect so slot centers are evenly spaced and
 *  reorderIndexForDragX has real geometry. Slot i sits at center x = (i+1)*100. */
function stubSlotRects(order: string[]) {
    order.forEach((id, i) => {
        const slot = document.querySelector<HTMLElement>(
            `[data-card-slot="${id}"]`
        );
        if (!slot) return;
        const centerX = (i + 1) * 100;
        slot.getBoundingClientRect = () =>
            ({
                left: centerX - 20,
                right: centerX + 20,
                width: 40,
                top: 0,
                bottom: 60,
                height: 60,
                x: centerX - 20,
                y: 0,
                toJSON: () => ({}),
            }) as DOMRect;
    });
}

/** Current presentation order, read from the rendered slot DOM order. */
function renderedOrder(): string[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>("[data-card-slot]")
    ).map((el) => el.getAttribute("data-card-slot")!);
}

beforeEach(() => {
    dragMoves.clear();
    cleanup();
});

describe("BoardHand drag-reorder (#271 fix 2)", () => {
    it("snaps a dragged card to the slot under the drop position", () => {
        const player = makePlayer(["a", "b", "c", "d"]);
        render(<BoardHand player={player} interactive layout={handLayout} />);
        expect(renderedOrder()).toEqual(["a", "b", "c", "d"]);

        // Slots at 100/200/300/400. Drag "a" to under slot 3 (x≈400).
        stubSlotRects(["a", "b", "c", "d"]);
        act(() => dragMoves.get("a")!(400));

        expect(renderedOrder()).toEqual(["b", "c", "d", "a"]);
        // The hand still holds the same four cards (view-only reorder).
        expect(renderedOrder().sort()).toEqual(["a", "b", "c", "d"]);
    });

    it("keeps the view-only order and appends a draw (no remount/reset)", () => {
        const player = makePlayer(["a", "b", "c"]);
        const { rerender } = render(
            <BoardHand player={player} interactive layout={handLayout} />
        );
        stubSlotRects(["a", "b", "c"]);
        act(() => dragMoves.get("a")!(300)); // reorder to a,b,c -> b,c,a
        expect(renderedOrder()).toEqual(["b", "c", "a"]);

        // Server hand changes (a new card drawn): the view-only permutation is
        // honoured for existing ids; the drawn card folds in at the end. The
        // existing slots are NOT remounted/reset (reconcile, not key-remount).
        rerender(
            <BoardHand
                player={makePlayer(["a", "b", "c", "d"])}
                interactive
                layout={handLayout}
            />
        );
        expect(renderedOrder()).toEqual(["b", "c", "a", "d"]);
    });

    it("drops a played/discarded card from the view order", () => {
        const player = makePlayer(["a", "b", "c"]);
        const { rerender } = render(
            <BoardHand player={player} interactive layout={handLayout} />
        );
        stubSlotRects(["a", "b", "c"]);
        act(() => dragMoves.get("a")!(300)); // a,b,c -> b,c,a
        expect(renderedOrder()).toEqual(["b", "c", "a"]);

        // "c" leaves the hand (played): it drops out, the rest keep their order.
        rerender(
            <BoardHand
                player={makePlayer(["a", "b"])}
                interactive
                layout={handLayout}
            />
        );
        expect(renderedOrder()).toEqual(["b", "a"]);
    });

    it("does not wire reorder on a non-interactive (opponent) hand", () => {
        render(
            <BoardHand
                player={makePlayer(["x", "y"])}
                interactive={false}
                layout={handLayout}
            />
        );
        // Opponent cards render the presentational BoardCard, not the
        // interactive hand card, so no drag-move callbacks are registered.
        expect(dragMoves.size).toBe(0);
        expect(screen.getAllByTestId("bn-card").length).toBe(2);
    });
});
