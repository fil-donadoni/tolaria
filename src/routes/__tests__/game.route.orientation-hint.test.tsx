// Surface-level guard for the board's OrientationHint mount (issue #2594,
// round-3 review on PR #2645). The rebase onto #2646 silently dropped the
// Draft Room's mount and NEITHER mount was ever guarded — the reviewer proved
// this by replacing `game.route.tsx`'s `<OrientationHint .../>` with `<></>`
// and watching 129 files / 953 tests stay green (`orientation-hint.test.tsx`
// only ever renders the component directly, never through a real surface).
// This test renders the REAL `GameRoute` (not a hand-built view) so deleting
// the mount fails it — see `docs/findings` / PR body for the proof-of-failure
// receipt.
import { describe, it, expect, vi, beforeEach } from "vitest";
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

// The seam under test: drive it explicitly rather than trust happy-dom's
// matchMedia (pattern shared with `controller-portrait.test.tsx`).
let viewportMode: "portrait" | "landscape-compact" | "desktop" = "portrait";
vi.mock("~/hooks/useViewportMode", () => ({
    useViewportMode: () => viewportMode,
}));

// Every other face of the route is irrelevant here — stand in as markers.
vi.mock("~/components/board/board", () => ({
    default: () => <div data-testid="gre-board" />,
}));
vi.mock("~/components/board/manual-board-container", () => ({
    default: () => <div data-testid="manual-board" />,
}));
vi.mock("~/components/board/manual-game-over-dialog", () => ({
    default: () => null,
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

beforeEach(() => {
    cleanup();
    sessionStorage.clear();
    game = { status: "playing", mode: undefined, players: [] };
});

describe("/game — OrientationHint mount (issue #2594)", () => {
    it("shows the game-board hint in portrait", () => {
        viewportMode = "portrait";
        render(<GameRoute />);

        expect(
            document.querySelector('[data-orientation-hint="game-board"]')
        ).toBeTruthy();
    });

    it("does NOT show the hint in desktop/landscape", () => {
        viewportMode = "desktop";
        render(<GameRoute />);

        expect(
            document.querySelector('[data-orientation-hint="game-board"]')
        ).toBeFalsy();
    });
});
