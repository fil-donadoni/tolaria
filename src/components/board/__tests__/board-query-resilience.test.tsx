// Issue #3266 — what the player sees when a game subscription fails.
//
// The bug: `useQuery` re-throws a failed execution during render, and with no
// error boundary inside the board that throw reaches the router's
// `CatchBoundaryImpl`, which unmounts `<Board>` / `<VsAiDriver>` and everything
// under them. A 1s platform ceiling missed under machine contention is not a
// reason to destroy a game view, so `<Board>` now renders through it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Id } from "@convex/_generated/dataModel";

const h = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock("convex/react", async () => {
    const { mockUseQueries } =
        await import("~/lib/testing/convex-react-query-mock");
    const resolve = () => h.result;
    return {
        useQuery: resolve,
        useQueries: mockUseQueries(resolve),
        useMutation: () => async () => {},
        useAction: () => async () => {},
    };
});
vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));

import Board from "../board";

function renderBoard() {
    return render(
        <Board
            gameId={"g1" as Id<"games">}
            playerId="p1"
            solo={false}
            vsAi={false}
            showAllCards={false}
            debugAllActions={false}
            onSwitchGame={() => {}}
        />
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    h.result = undefined;
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("Board query resilience (issue #3266)", () => {
    it("renders through a transient execution timeout instead of throwing", () => {
        h.result = new Error(
            "[CONVEX Q(game:getPublicState)] Function execution timed out (maximum duration: 1s)"
        );
        // The assertion IS that this returns: before the fix the render threw,
        // and the throw is what the router's catch boundary turned into a
        // teardown of the whole game tree.
        expect(() => renderBoard()).not.toThrow();
        // Still inside the retry budget, so no error surface — the board is
        // waiting, exactly as it does before the first state arrives.
        expect(screen.queryByText(/Lost contact with the game/)).toBeNull();
    });

    it("shows a friendly surface with a retry affordance once it escalates", () => {
        // A non-transient failure escalates on the first occurrence.
        h.result = new Error(
            "[CONVEX Q(game:getPublicState)] Uncaught ConvexError: not your game"
        );
        renderBoard();

        expect(screen.getByText(/Lost contact with the game/)).toBeTruthy();
        expect(screen.getByRole("button", { name: /Retry/i })).toBeTruthy();
        // Never the raw envelope: "[CONVEX Q(...)] Uncaught ConvexError" is
        // what the catch boundary used to put on screen.
        expect(screen.queryByText(/ConvexError/)).toBeNull();
    });
});
