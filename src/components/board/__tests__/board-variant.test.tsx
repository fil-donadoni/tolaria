// Seam 1 (PRD #249, issue #250): the board-variant selector mounts the new
// DOM-only spatial root when `?board=next` is set, and the current board by
// default. This test exercises the real <Board> orchestrator with the two
// spatial roots stubbed, so it asserts the selector wiring end-to-end (search
// param → resolveBoardVariant → which tree mounts) rather than the pure helper
// in isolation.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Player } from "~/types/game";

// --- Search param control -------------------------------------------------
// The selector reads the URL via TanStack's useSearch. Drive it from a mutable
// holder so each case sets the param it needs.
let mockSearch: Record<string, unknown> = {};
vi.mock("@tanstack/react-router", () => ({
    useSearch: () => mockSearch,
}));

// --- Convex state ---------------------------------------------------------
// getPublicState drives the board; return a minimal two-player snapshot. The
// id queries return empty so the preload effects are no-ops.
const me: Player = {
    id: "me",
    name: "Me",
    bgColor: "#000",
    life: 20,
    hand: [],
    library: { count: 0 },
    graveyard: [],
    exile: [],
    battlefield: [],
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
};
const opp: Player = { ...me, id: "opp", name: "Opp" };

const PUBLIC_STATE = {
    players: [me, opp],
    activePlayerId: "me",
    priorityPlayerId: "me",
    phase: "PRECOMBAT_MAIN",
    turn: 1,
    stack: [],
};

vi.mock("@convex/_generated/api", () => ({
    api: { game: { getPublicState: "getPublicState" } },
}));

vi.mock("convex/react", () => ({
    useQuery: (ref: unknown) => (ref === "getPublicState" ? PUBLIC_STATE : []),
    useMutation: () => () => Promise.resolve(null),
}));

// --- Spatial roots: stub so we can assert which one mounts ------------------
vi.mock("../board-classic", () => ({
    default: () => <div data-testid="board-classic" />,
}));
vi.mock("../board-next", () => ({
    default: () => <div data-testid="board-next" />,
}));

// --- Chrome / hooks that need transport, scheduling, or refs ----------------
// None of these participate in variant selection; stub to inert markup so the
// orchestrator renders without Convex/router/scheduler wiring.
vi.mock("../action-bar", () => ({ default: () => null }));
vi.mock("../auto-pass-controller", () => ({ default: () => null }));
vi.mock("../game-over-dialog", () => ({ default: () => null }));
vi.mock("../pause-menu-dialog", () => ({ default: () => null }));
vi.mock("../target-selection-banner", () => ({ default: () => null }));
vi.mock("../payment-banner", () => ({ default: () => null }));
vi.mock("../pending-choice-prompt", () => ({ default: () => null }));
vi.mock("../mulligan-prompt", () => ({ default: () => null }));
vi.mock("../error-toast", () => ({ default: () => null }));
vi.mock("../vs-ai-driver", () => ({ default: () => null }));

vi.mock("~/lib/image-preload", () => ({ preloadCardImages: () => {} }));
vi.mock("~/hooks/usePageVisible", () => ({ usePageVisible: () => true }));

// SkipPhasePrefsContext / PendingChoiceBufferContext are used as JSX elements
// (`<Ctx value=...>`); stub them as pass-through wrapper components so the
// orchestrator renders without the real context state.
vi.mock("~/hooks/useSkipPhasePreferences", () => ({
    SkipPhasePrefsContext: ({ children }: { children: React.ReactNode }) =>
        children,
    useSkipPhasePrefsState: () => ({}),
}));
vi.mock("~/hooks/usePendingChoiceBuffer", () => ({
    PendingChoiceBufferContext: ({ children }: { children: React.ReactNode }) =>
        children,
    usePendingChoiceBufferState: () => ({
        buffer: [],
        lastError: null,
        dismissError: () => {},
    }),
}));

import Board from "../board";

function renderBoard() {
    return render(
        <Board
            gameId={"game-id" as never}
            playerId="me"
            solo={false}
            vsAi={false}
            showAllCards={false}
            debugAllActions={false}
        />
    );
}

describe("board-variant selector (seam 1, #250)", () => {
    beforeEach(() => {
        cleanup();
        mockSearch = {};
    });

    it("mounts the classic spatial root by default (no ?board param)", () => {
        mockSearch = {};
        renderBoard();
        expect(screen.getByTestId("board-classic")).toBeTruthy();
        expect(screen.queryByTestId("board-next")).toBeNull();
    });

    it("mounts the next spatial root when ?board=next is set", () => {
        mockSearch = { board: "next" };
        renderBoard();
        expect(screen.getByTestId("board-next")).toBeTruthy();
        expect(screen.queryByTestId("board-classic")).toBeNull();
    });

    it("falls back to classic for an unrecognized ?board value", () => {
        mockSearch = { board: "legacy" };
        renderBoard();
        expect(screen.getByTestId("board-classic")).toBeTruthy();
        expect(screen.queryByTestId("board-next")).toBeNull();
    });
});
