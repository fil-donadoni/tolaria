// Issue #2930: the desktop stack panel folds down to its header. The real
// `GameStack` + real `DragHandle` are under test (unlike the sibling stack
// tests, which stub the handle out) because the fold control lives in it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import type { StackItem } from "~/types/game";
import { GameContext } from "~/hooks/useGameContext";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn() }));
vi.mock("~/hooks/useDraggable", () => ({
    useDraggable: () => ({ offset: { x: 0, y: 0 }, dragHandlers: {} }),
}));
vi.mock("~/hooks/use-leader-lines", () => ({
    repositionLeaderLines: () => {},
}));
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

function renderStack(
    stack: StackItem[],
    props: React.ComponentProps<typeof GameStack> extends infer P
        ? Partial<P>
        : never = {},
    pendingTarget?: unknown
) {
    const value = {
        gameId: "game-id" as never,
        playerId: "me",
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        engineTurn: 1,
        stackCount: stack.length,
        stackItems: [],
        allPlayers: [],
        showAllCards: false,
        debugAllActions: false,
        pendingTarget,
        onSwitchGame: () => {},
    } as React.ContextType<typeof GameContext>;
    const tree = (s: StackItem[], p: typeof props) => (
        <GameContext value={value}>
            <GameStack stack={s} {...p} />
        </GameContext>
    );
    const view = render(tree(stack, props));
    return {
        ...view,
        rerenderWith: (s: StackItem[], p: typeof props = props) =>
            view.rerender(tree(s, p)),
    };
}

const rows = () => document.querySelectorAll("[data-arrow-anchor-stack]");

beforeEach(() => cleanup());

describe("GameStack collapse (issue #2930)", () => {
    it("pressing the toggle never starts a drag (real useDraggable filter)", async () => {
        const real = await vi.importActual<
            typeof import("~/hooks/useDraggable")
        >("~/hooks/useDraggable");
        const { renderHook, act } = await import("@testing-library/react");
        const { result } = renderHook(() => real.useDraggable());
        const toggle = document.createElement("button");
        const handle = document.createElement("div");
        handle.appendChild(toggle);
        act(() => {
            result.current.dragHandlers.onPointerDown({
                target: toggle,
                clientX: 0,
                clientY: 0,
            } as never);
            result.current.dragHandlers.onPointerMove({
                clientX: 50,
                clientY: 50,
                currentTarget: handle,
                pointerId: 1,
            } as never);
        });
        expect(result.current.offset).toEqual({ x: 0, y: 0 });
    });

    it("shows no toggle when the caller passes none (portrait/landscape keep their chips)", () => {
        renderStack([makeStackItem("a")]);
        expect(screen.queryByTestId("stack-collapse-toggle")).toBeNull();
    });

    it("expanded: rows render and the toggle offers to collapse", () => {
        renderStack([makeStackItem("a"), makeStackItem("b")], {
            collapsed: false,
            onToggleCollapse: () => {},
        });
        expect(rows()).toHaveLength(2);
        const toggle = screen.getByTestId("stack-collapse-toggle");
        expect(toggle.getAttribute("aria-label")).toBe("Collapse stack");
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
    });

    it("collapsed: rows are gone but the header still reports the depth", () => {
        renderStack([makeStackItem("a"), makeStackItem("b")], {
            collapsed: true,
            onToggleCollapse: () => {},
        });
        expect(rows()).toHaveLength(0);
        expect(screen.getByTestId("game-stack").textContent).toContain(
            "Stack (2)"
        );
        const toggle = screen.getByTestId("stack-collapse-toggle");
        expect(toggle.getAttribute("aria-label")).toBe("Expand stack");
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
    });

    it("the toggle calls back, and collapse/expand round-trips through the caller's state", () => {
        const onToggle = vi.fn();
        const { rerenderWith } = renderStack([makeStackItem("a")], {
            collapsed: false,
            onToggleCollapse: onToggle,
        });
        fireEvent.click(screen.getByTestId("stack-collapse-toggle"));
        expect(onToggle).toHaveBeenCalledTimes(1);

        rerenderWith([makeStackItem("a")], {
            collapsed: true,
            onToggleCollapse: onToggle,
        });
        expect(rows()).toHaveLength(0);
        rerenderWith([makeStackItem("a")], {
            collapsed: false,
            onToggleCollapse: onToggle,
        });
        expect(rows()).toHaveLength(1);
    });

    it("stays collapsed while items are pushed and resolved, and the depth tracks them", () => {
        const props = { collapsed: true, onToggleCollapse: () => {} };
        const { rerenderWith } = renderStack([makeStackItem("a")], props);
        rerenderWith([makeStackItem("a"), makeStackItem("b")], props);
        expect(rows()).toHaveLength(0);
        expect(screen.getByTestId("game-stack").textContent).toContain(
            "Stack (2)"
        );
        rerenderWith([makeStackItem("a")], props);
        expect(rows()).toHaveLength(0);
        expect(screen.getByTestId("game-stack").textContent).toContain(
            "Stack (1)"
        );
    });

    it("keeps its z-tier whether collapsed or not", () => {
        const a = renderStack([makeStackItem("a")], {
            collapsed: false,
            onToggleCollapse: () => {},
        });
        const open = screen.getByTestId("game-stack").className;
        a.unmount();
        renderStack([makeStackItem("a")], {
            collapsed: true,
            onToggleCollapse: () => {},
        });
        expect(screen.getByTestId("game-stack").className).toBe(open);
        expect(open).toContain("z-modal");
    });

    it("a spell-target pick forces the rows open and locks the toggle", () => {
        renderStack(
            [makeStackItem("a")],
            { collapsed: true, onToggleCollapse: () => {} },
            {
                playerId: "me",
                cardInstanceId: "src",
                targetType: "spell",
                count: 1,
                selected: [],
            }
        );
        expect(rows()).toHaveLength(1);
        expect(
            (screen.getByTestId("stack-collapse-toggle") as HTMLButtonElement)
                .disabled
        ).toBe(true);
    });
});
