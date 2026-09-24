// Issue #2930: the desktop fold is held by `BoardSurface`, not `GameStack`,
// because the desktop mount unmounts the panel whenever the stack empties.
// The real `Board` + `BoardSurface` are driven; `GameStack` is a stub that
// reports the props it was handed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import type { Player } from "~/types/game";

vi.mock("~/hooks/useIsPortrait", () => ({ useIsPortrait: () => false }));
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop",
}));
vi.mock("~/hooks/useViewportHeight", () => ({
    useViewportHeight: () => 900,
}));
vi.mock("~/hooks/useElementSize", () => ({
    useElementSize: () => ({
        ref: { current: null },
        size: { width: 1200, height: 300 },
    }),
}));

const h = vi.hoisted(() => ({ state: undefined as unknown }));
vi.mock("convex/react", async () => {
    const { mockUseQueries } =
        await import("~/lib/testing/convex-react-query-mock");
    const resolve = () => h.state;
    return {
        useQuery: resolve,
        useQueries: mockUseQueries(resolve),
        useMutation: () => async () => {},
        useAction: () => async () => {},
    };
});
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));

vi.mock("../controller", () => ({ default: () => null }));
vi.mock("../auto-pass-controller", () => ({ default: () => null }));
vi.mock("../pause-menu-dialog", () => ({ default: () => null }));
vi.mock("../error-toast", () => ({ default: () => null }));
vi.mock("../board-background", () => ({ default: () => null }));
vi.mock("../vs-ai-driver", () => ({ default: () => null }));
vi.mock("../board-arrows", () => ({ default: () => null }));
vi.mock("../board-piles", () => ({ default: () => null }));
vi.mock("../board-battlefield", () => ({ default: () => null }));
vi.mock("../priority-indicator", () => ({ default: () => null }));
vi.mock("../board-hand", () => ({ default: () => null }));
vi.mock("../board-player", () => ({ default: () => null }));
vi.mock("../game-stack", () => ({
    default: (p: {
        stack: unknown[];
        collapsed?: boolean;
        onToggleCollapse?: () => void;
    }) => (
        <button
            data-testid="game-stack-mock"
            data-count={p.stack.length}
            data-collapsed={String(!!p.collapsed)}
            onClick={p.onToggleCollapse}
        />
    ),
}));

import Board from "../board";

function makePlayer(id: string): Player {
    return {
        id,
        name: id,
        bgColor: "#000",
        life: 20,
        hand: [],
        library: { count: 0 },
        graveyard: [],
        exile: [],
        battlefield: [],
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    } as unknown as Player;
}

const item = (id: string) => ({
    id,
    card: { id: `def-${id}` },
    controllerId: "me",
    ownerId: "me",
    zone: "stack",
    isTapped: false,
});

function setStack(stack: unknown[]) {
    h.state = {
        players: [makePlayer("opp"), makePlayer("me")],
        activePlayerId: "me",
        priorityPlayerId: "me",
        phase: "PRECOMBAT_MAIN",
        turn: 1,
        stack,
    };
}

const board = () => (
    <Board
        gameId={"game-id" as never}
        playerId="me"
        solo={false}
        vsAi={false}
        showAllCards={false}
        debugAllActions={false}
        onSwitchGame={() => {}}
    />
);

beforeEach(cleanup);

describe("desktop stack fold is held above the panel (issue #2930)", () => {
    it("survives a push, a resolve and the stack emptying entirely", () => {
        setStack([item("a")]);
        const { rerender } = render(board());
        expect(screen.getByTestId("game-stack-mock").dataset.collapsed).toBe(
            "false"
        );

        fireEvent.click(screen.getByTestId("game-stack-mock"));
        expect(screen.getByTestId("game-stack-mock").dataset.collapsed).toBe(
            "true"
        );

        setStack([item("a"), item("b")]);
        rerender(board());
        expect(screen.getByTestId("game-stack-mock").dataset.count).toBe("2");
        expect(screen.getByTestId("game-stack-mock").dataset.collapsed).toBe(
            "true"
        );

        setStack([]);
        rerender(board());
        expect(screen.queryByTestId("game-stack-mock")).toBeNull();

        setStack([item("c")]);
        rerender(board());
        expect(screen.getByTestId("game-stack-mock").dataset.collapsed).toBe(
            "true"
        );
    });
});
