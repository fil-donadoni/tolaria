// `/game`'s game switch persists the session (issue #9518).
//
// The Bo3 sideboarding hand-off moves the route onto Game 2 through
// `onSwitchGame`. When only the React state moved, `localStorage` kept naming
// Game 1, so every reader of `getStoredSession()` — the in-app bug report, a
// reload, the debug quizzes — pointed at the finished game. The route's
// `handleSwitchGame` is the one authority that persists it; this suite drives
// the REAL sideboarding dialog through the REAL route and reads the REAL
// session store back.

import type { ComponentProps, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    render,
    cleanup,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";
import type { PublicMatch } from "@convex/matches";
import type { Id } from "@convex/_generated/dataModel";
import { GameContext } from "~/hooks/useGameContext";
import { getStoredSession, storeSession } from "~/lib/session";
import SideboardingDialog from "~/components/board/sideboarding-dialog";

const setReady = vi.fn(() =>
    Promise.resolve({ gameId: "game_2" as string | null })
);
const submitSideboard = vi.fn(() => Promise.resolve(undefined));

vi.mock("convex/react", async () => {
    const { mockUseQueries } =
        await import("~/lib/testing/convex-react-query-mock");
    // Every game the route asks for is a GRE game in play.
    const resolve = () => ({ status: "playing", players: [{ id: "me" }] });
    return {
        useQuery: () => undefined,
        useQueries: mockUseQueries(resolve),
        useMutation: (ref: string) =>
            ref === "game:setReady"
                ? setReady
                : ref === "gameTable:submitSideboard"
                  ? submitSideboard
                  : vi.fn(),
    };
});
vi.mock("@convex/_generated/api", () => ({
    api: {
        game: { setReady: "game:setReady" },
        gameTable: {
            leaveGame: "gameTable:leaveGame",
            submitSideboard: "gameTable:submitSideboard",
        },
        gameReads: { getGame: "gameReads:getGame" },
        users: { currentUser: "users:currentUser" },
    },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("~/components/board/definition-manifest-gate", () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/ui/catalogue-gate", () => ({
    default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("~/components/debug/debug-sheet", () => ({ default: () => null }));
vi.mock("~/components/ui/loading-screen", () => ({ default: () => null }));

// The board stands in for the one thing it does on this path: it hands the
// route's `onSwitchGame` to the board subtree through `GameContext`, where the
// sideboarding dialog reads it — exactly as `board.tsx` does.
type GameCtxValue = ComponentProps<typeof GameContext>["value"];
vi.mock("~/components/board/board", () => ({
    default: (props: {
        gameId: string;
        playerId: string;
        onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
    }) => (
        <div data-testid="gre-board" data-game-id={props.gameId}>
            <GameContext
                value={
                    {
                        onSwitchGame: props.onSwitchGame,
                    } as unknown as GameCtxValue
                }
            >
                <SideboardingDialog match={MATCH} viewerId={props.playerId} />
            </GameContext>
        </div>
    ),
}));

const CARD = "d573ef03-4730-45aa-93dd-e45ac1dbaf4a";
const MATCH: PublicMatch = {
    matchId: "match_1" as PublicMatch["matchId"],
    bestOf: 3,
    status: "sideboarding",
    currentGameNumber: 1,
    solo: false,
    vsAi: true,
    players: [
        {
            id: "me",
            name: "Me",
            bgColor: "#000",
            score: 0,
            ready: false,
            deck: {
                id: "d",
                name: "Deck",
                format: "vintage",
                maindeck: [{ cardId: CARD, cardName: "Alpha" }],
                sideboard: [],
            },
        },
        { id: "bot", name: "Bot", bgColor: "#111", score: 1, ready: true },
    ],
};

import GameRoute from "../game.route";

beforeEach(() => {
    cleanup();
    localStorage.clear();
    setReady.mockClear();
});

describe("/game — switching games persists the session (issue #9518)", () => {
    it("the Bo3 sideboarding hand-off re-points the stored session at the next Game", async () => {
        storeSession("game_1" as Id<"games">, "me");
        render(<GameRoute />);

        fireEvent.click(
            document.querySelector<HTMLButtonElement>("[data-ready-state]")!
        );

        // The route moved onto Game 2 …
        await waitFor(() =>
            expect(
                screen.getByTestId("gre-board").getAttribute("data-game-id")
            ).toBe("game_2")
        );
        expect(setReady).toHaveBeenCalledOnce();
        // … and so did every reader of the stored session.
        expect(getStoredSession()).toEqual({
            gameId: "game_2",
            playerId: "me",
        });
    });
});
