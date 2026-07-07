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

describe("GameStack ability-kind detection (#935)", () => {
    it("renders a delayed triggered ability as an ability tile, not card art", () => {
        // Mishra's Bauble's "Draw a card at the beginning of the next turn's
        // upkeep" delayed trigger (CR 603.7a) must render via StackAbilityTile
        // (a third ability kind alongside activated/triggered), not fall
        // through to the source card image.
        const item = {
            ...makeStackItem("delayed-1"),
            card: { id: "8a720448-017f-4f4a-9501-678245eaed17" }, // Mishra's Bauble
            delayedTriggerId: "next-upkeep-cantrip",
        } as StackItem;
        const { container, queryByTestId } = renderStack([item]);

        expect(
            container.querySelector('[data-arrow-anchor-stack="delayed-1"]')
        ).not.toBeNull();
        // The ability-tile path renders — not the source card image mock.
        expect(queryByTestId("stack-card")).toBeNull();
        expect(container.textContent).toContain(
            "Draw a card at the beginning of the next turn's upkeep."
        );
    });
});

describe("GameStack play-area anchor", () => {
    it("anchors to the right edge of the play area (left of the reserved strip)", () => {
        // Play-area layout rule: the floating stack panel anchors its right
        // edge to `--right-piles-w` (the reserved right strip) rather than the
        // viewport, so it sits just BEFORE the piles/preview column. Portrait ⇒
        // var resolves to 0px ⇒ flush to the edge.
        const { container } = renderStack([makeStackItem("only")]);
        const panel = container.firstElementChild as HTMLElement;
        expect(panel.style.right).toBe("var(--right-piles-w)");
        // No hard-coded viewport right inset remains.
        expect(panel.className).not.toContain("right-4");
    });
});
