// Drag-reorder v2 — DEFERRED COMMIT. The viewer's hand no longer reorders live
// while a card is dragged: the item array (and every card's DOM node) stays put
// so the dragged node keeps its pointer capture, and the new order is applied
// ONCE, on release (onDragEnd). During the drag only the presentation gap moves.
// These tests drive the real BoardHand: leaf cards are inert markers that expose
// their onDragMove / onDragEnd callbacks; slot centers come from the SAME pure
// fan the component uses (useElementSize is stubbed to a fixed box), so the
// pointer x fed to a drag is chosen to snap onto a known slot.
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

// Capture each interactive hand card's onDragMove / onDragEnd so a test can fire
// a drag + drop without a full pointer simulation. Overwritten each render so the
// captured callbacks always close over the latest component state.
const dragMoves = new Map<string, (x: number) => void>();
const dragEnds = new Map<string, () => void>();
vi.mock("../board-hand-card", () => ({
    default: ({
        card,
        onDragMove,
        onDragEnd,
    }: {
        card: CardInstance;
        onDragMove?: (x: number) => void;
        onDragEnd?: () => void;
    }) => {
        if (onDragMove) dragMoves.set(card.id, onDragMove);
        if (onDragEnd) dragEnds.set(card.id, onDragEnd);
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

/** Client-x center of each fan slot for a hand of `count` cards (zone left = 0,
 *  since useElementSize's ref is stubbed null). Lets a test pick a pointer x that
 *  snaps onto a chosen slot index. */
function slotCenters(count: number): number[] {
    return handLayout(count, ZONE_W, ZONE_H).map((p) => p.x);
}

/** Drag `id` so it drops onto slot `toIndex`, then release. */
function dragDrop(id: string, count: number, toIndex: number) {
    const x = slotCenters(count)[toIndex];
    act(() => dragMoves.get(id)!(x));
    act(() => dragEnds.get(id)!());
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

/** Current presentation order, read from the rendered slot DOM order. */
function renderedOrder(): string[] {
    return Array.from(
        document.querySelectorAll<HTMLElement>("[data-card-slot]")
    ).map((el) => el.getAttribute("data-card-slot")!);
}

beforeEach(() => {
    dragMoves.clear();
    dragEnds.clear();
    cleanup();
});

describe("BoardHand drag-reorder v2 (deferred commit)", () => {
    it("does NOT reorder mid-drag — the item order holds until release", () => {
        const player = makePlayer(["a", "b", "c", "d"]);
        render(<BoardHand player={player} interactive layout={handLayout} />);
        expect(renderedOrder()).toEqual(["a", "b", "c", "d"]);

        // Move "a" all the way onto the last slot, but do NOT release.
        act(() => dragMoves.get("a")!(slotCenters(4)[3]));
        // The item array (DOM node order) is unchanged — only the gap moved.
        expect(renderedOrder()).toEqual(["a", "b", "c", "d"]);
    });

    it("commits the reorder on drop (card lands on the drop slot)", () => {
        const player = makePlayer(["a", "b", "c", "d"]);
        render(<BoardHand player={player} interactive layout={handLayout} />);

        // Drag "a" onto slot 3 and release: a,b,c,d -> b,c,d,a.
        dragDrop("a", 4, 3);
        expect(renderedOrder()).toEqual(["b", "c", "d", "a"]);
        // Same four cards — a view-only reorder, nothing added/removed.
        expect(renderedOrder().slice().sort()).toEqual(["a", "b", "c", "d"]);
    });

    it("is a no-op on drop when the card returns to its own slot", () => {
        const player = makePlayer(["a", "b", "c", "d"]);
        render(<BoardHand player={player} interactive layout={handLayout} />);
        // Drag "b" onto its own slot (index 1) and release.
        dragDrop("b", 4, 1);
        expect(renderedOrder()).toEqual(["a", "b", "c", "d"]);
    });

    it("keeps the committed order and appends a draw (no remount/reset)", () => {
        const player = makePlayer(["a", "b", "c"]);
        const { rerender } = render(
            <BoardHand player={player} interactive layout={handLayout} />
        );
        dragDrop("a", 3, 2); // commit a,b,c -> b,c,a
        expect(renderedOrder()).toEqual(["b", "c", "a"]);

        // A drawn card folds in at the end; the committed permutation is kept and
        // existing slots are reconciled (not key-remounted).
        rerender(
            <BoardHand
                player={makePlayer(["a", "b", "c", "d"])}
                interactive
                layout={handLayout}
            />
        );
        expect(renderedOrder()).toEqual(["b", "c", "a", "d"]);
    });

    it("drops a played/discarded card from the committed order", () => {
        const player = makePlayer(["a", "b", "c"]);
        const { rerender } = render(
            <BoardHand player={player} interactive layout={handLayout} />
        );
        dragDrop("a", 3, 2); // commit a,b,c -> b,c,a
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
        expect(dragMoves.size).toBe(0);
        expect(screen.getAllByTestId("bn-card").length).toBe(2);
    });
});
