// `/game`'s manual branch: which face a Tabletop game shows once it is over.
//
// The route renders the same component for `playing` and `finished`, which is
// harmless for a GRE game (the board keeps its `gameStates` row and overlays
// `GameOverDialog` itself) and a dead end for a manual one: `manualConcedeMatch`
// DELETES the game's `manualStates` rows, so `ManualBoardContainer` subscribes
// to a null state and renders "Loading..." forever — the conceding player is
// stranded on a spinner with no way back to the lobby. Hence the explicit
// `finished` branch this test pins.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";

let game: Record<string, unknown> | undefined;

vi.mock("convex/react", () => ({
    useQuery: () => game,
    useMutation: () => vi.fn(),
}));
vi.mock("@convex/_generated/api", () => ({
    api: { game: { getGame: {}, leaveGame: {} } },
}));
vi.mock("@tanstack/react-router", () => ({
    useNavigate: () => vi.fn(),
}));
vi.mock("~/lib/session", () => ({
    getStoredSession: () => ({ gameId: "game_1", playerId: "me" }),
    clearSession: vi.fn(),
}));

// Every face of the route stands in as a marker, so the assertions are about
// WHICH one mounted and nothing else.
vi.mock("~/components/board/board", () => ({
    default: () => <div data-testid="gre-board" />,
}));
vi.mock("~/components/board/manual-board-container", () => ({
    default: () => <div data-testid="manual-board" />,
}));
vi.mock("~/components/board/manual-game-over-dialog", () => ({
    default: () => <div data-testid="manual-game-over" />,
}));
vi.mock("~/components/board/pregame-dialog", () => ({ default: () => null }));
vi.mock("~/components/board/waiting-for-opponent", () => ({
    default: () => null,
}));
vi.mock("~/components/debug/debug-panel", () => ({ default: () => null }));
vi.mock("~/components/debug/ai-decision-trace-box", () => ({
    default: () => null,
}));
vi.mock("~/components/debug/dev-panel-rail", () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/ui/loading-screen", () => ({ default: () => null }));

import GameRoute from "../game.route";

beforeEach(() => cleanup());

describe("/game — manual mode", () => {
    it("mounts the manual board while the game is playing", () => {
        game = { status: "playing", mode: "manual", players: [], solo: true };
        render(<GameRoute />);

        expect(screen.queryByTestId("manual-board")).toBeTruthy();
        expect(screen.queryByTestId("manual-game-over")).toBeFalsy();
    });

    it("replaces the board with the result screen once the game is finished", () => {
        game = {
            status: "finished",
            mode: "manual",
            winner: "opp",
            players: [
                { id: "me", name: "Me" },
                { id: "opp", name: "Rival" },
            ],
            solo: true,
        };
        render(<GameRoute />);

        expect(screen.queryByTestId("manual-game-over")).toBeTruthy();
        expect(screen.queryByTestId("manual-board")).toBeFalsy();
    });

    it("leaves the GRE board owning its own game-over overlay", () => {
        game = { status: "finished", mode: undefined, players: [] };
        render(<GameRoute />);

        expect(screen.queryByTestId("gre-board")).toBeTruthy();
        expect(screen.queryByTestId("manual-game-over")).toBeFalsy();
    });
});
