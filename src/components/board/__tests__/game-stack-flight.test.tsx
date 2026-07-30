// GameStack participates in the board's shared-layout identity (zone-change
// flights): each stack item carries a `data-flight-id` keyed by its stable
// instance id — the hook the motion `layoutId` matches across zones — and a
// just-cast / just-resolved item plays the arrival glow while it is in the
// GameContext `recentArrivals` set.
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

function renderStack(stack: StackItem[], recentArrivals?: ReadonlySet<string>) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: stack.length,
        allPlayers: [],
        recentArrivals,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    return render(
        <GameContext value={value}>
            <GameStack stack={stack} />
        </GameContext>
    );
}

beforeEach(() => cleanup());

describe("GameStack zone-change flight participation", () => {
    it("tags every item with its stable instance id as the flight id", () => {
        const stack = [makeStackItem("bottom"), makeStackItem("top")];
        const { container } = renderStack(stack);
        const flightIds = Array.from(
            container.querySelectorAll<HTMLElement>("[data-flight-id]")
        ).map((el) => el.getAttribute("data-flight-id"));
        // LIFO render order: top (last cast) first.
        expect(flightIds).toEqual(["top", "bottom"]);
    });

    it("plays the arrival glow only on items in recentArrivals", () => {
        const stack = [makeStackItem("old"), makeStackItem("fresh")];
        const { container } = renderStack(stack, new Set(["fresh"]));
        const glowed = Array.from(
            container.querySelectorAll<HTMLElement>("[data-arrival-glow]")
        ).map((el) =>
            el.closest("[data-flight-id]")?.getAttribute("data-flight-id")
        );
        expect(glowed).toEqual(["fresh"]);
    });

    it("lets in-flight items paint outside the panel (no clipping)", () => {
        // A spell flying in from the hand mounts inside the stack panel; an
        // overflow-hidden panel would clip the flight to the panel boundary.
        const { container } = renderStack([makeStackItem("only")]);
        const panel = container.firstElementChild
            ?.firstElementChild as HTMLElement | null;
        expect(panel?.className).toContain("overflow-visible");
        expect(panel?.className).not.toContain("overflow-hidden");
    });
});
