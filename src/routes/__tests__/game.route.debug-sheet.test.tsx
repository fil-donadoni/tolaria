// Who gets the debug sheet (issue #3403, PRD #3397).
//
// The old rail was mounted behind `import.meta.env.DEV` alone, which meant it
// existed nowhere a tester actually plays. The sheet ships to PRODUCTION, so
// the gate is now a role — and a gate that is only ever exercised at the
// predicate (`adminGating.test.ts`) proves nothing about the route that has to
// call it. These tests render the REAL `GameRoute` with `DEV` stubbed off, so
// deleting the `showDebugSheet &&` guard, or wiring it to the wrong predicate,
// fails here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

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
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => "desktop" as const,
}));

/** The seam the gate reads. Driven explicitly — `useQuery` above answers every
 *  query with the game row, so the real hook could not tell a tester from a
 *  regular player here. */
let currentUser: Record<string, unknown> | null | undefined = null;
vi.mock("~/hooks/useCurrentUser", () => ({
    useCurrentUser: () => currentUser,
}));

vi.mock("~/components/board/board", () => ({
    default: () => <div data-testid="gre-board" />,
}));
vi.mock("~/components/board/manual-board-container", () => ({
    default: () => null,
}));
vi.mock("~/components/board/manual-game-over-dialog", () => ({
    default: () => null,
}));
vi.mock("~/components/board/pregame-dialog", () => ({ default: () => null }));
vi.mock("~/components/board/waiting-for-opponent", () => ({
    default: () => null,
}));
vi.mock("~/components/ui/orientation-hint", () => ({ default: () => null }));
vi.mock("~/components/ui/loading-screen", () => ({ default: () => null }));
vi.mock("~/components/debug/debug-sheet", () => ({
    default: () => <div data-testid="debug-sheet" />,
}));

import GameRoute from "../game.route";

function mounted() {
    return document.querySelector('[data-testid="debug-sheet"]') !== null;
}

beforeEach(() => {
    cleanup();
    localStorage.clear();
    game = { status: "playing", mode: undefined, vsAi: false, players: [] };
});
afterEach(() => vi.unstubAllEnvs());

describe("/game — debug sheet gating (issue #3403)", () => {
    it("is absent for a regular player in a production build", () => {
        vi.stubEnv("DEV", false);
        currentUser = { _id: "u1" };
        render(<GameRoute />);
        expect(
            document.querySelector('[data-testid="gre-board"]')
        ).toBeTruthy();
        expect(mounted()).toBe(false);
    });

    it("is absent while the current-user query is still in flight", () => {
        vi.stubEnv("DEV", false);
        currentUser = undefined;
        render(<GameRoute />);
        expect(mounted()).toBe(false);
    });

    it("mounts for a tester in a production build", () => {
        vi.stubEnv("DEV", false);
        currentUser = { _id: "u1", isTester: true };
        render(<GameRoute />);
        expect(mounted()).toBe(true);
    });

    it("mounts for an admin — every admin reads as a tester", () => {
        vi.stubEnv("DEV", false);
        currentUser = { _id: "u1", isAdmin: true };
        render(<GameRoute />);
        expect(mounted()).toBe(true);
    });

    it("mounts for whoever is signed in to a dev build", () => {
        vi.stubEnv("DEV", true);
        currentUser = { _id: "u1" };
        render(<GameRoute />);
        expect(mounted()).toBe(true);
    });
});
