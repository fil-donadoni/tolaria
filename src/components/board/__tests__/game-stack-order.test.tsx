// Slice #255 (PRD #249): the stack renders as an ordered spatial element
// showing resolution order — LIFO, the last-cast item resolves first and reads
// first (leftmost). This test asserts the external DOM order against the
// stack's logical order, so the "top resolves first" read survives refactors of
// the tile internals.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("~/hooks/use-leader-lines", () => ({
    repositionLeaderLines: () => {},
}));
vi.mock("../drag-handle", () => ({ default: () => null }));
vi.mock("../../cards/color-overlay-card-image", () => ({
    default: ({ card }: { card: StackItem }) => (
        <div data-testid="stack-card" data-card-id={card.id} />
    ),
}));

import GameStack from "../game-stack";

function makeStackItem(id: string): StackItem {
    return {
        id,
        card: { id: "def-" + id },
        controllerId: "me",
        ownerId: "me",
        zone: "stack",
        isTapped: false,
    } as StackItem;
}

function renderStack(stack: StackItem[]) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stackCount: stack.length,
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GameStack stack={stack} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("GameStack resolution order (slice #255)", () => {
    it("renders the stack in LIFO order — top of stack (last cast) first", () => {
        // Logical stack order is bottom → top: 'bottom' was cast first,
        // 'top' last. The top resolves first, so it must render first/leftmost.
        const stack = [
            makeStackItem("bottom"),
            makeStackItem("middle"),
            makeStackItem("top"),
        ];
        const { container } = renderStack(stack);

        const order = Array.from(
            container.querySelectorAll<HTMLElement>("[data-arrow-anchor-stack]")
        ).map((el) => el.getAttribute("data-arrow-anchor-stack"));

        expect(order).toEqual(["top", "middle", "bottom"]);
    });
});
