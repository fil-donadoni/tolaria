import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { useResilientQuery } from "~/hooks/useResilientQuery";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Board from "~/components/board/board";
import ManualBoardContainer from "~/components/board/manual-board-container";
import ManualGameOverDialog from "~/components/board/manual-game-over-dialog";
import PregameDialog from "~/components/board/pregame-dialog";
import DebugSheet from "~/components/debug/debug-sheet";
import LoadingScreen from "~/components/ui/loading-screen";
import WaitingForOpponent from "~/components/board/waiting-for-opponent";
import OrientationHint from "~/components/ui/orientation-hint";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useViewportMode } from "~/hooks/useViewportMode";
import { canUseDebugSheet } from "~/lib/adminGating";
import { clearSession, getStoredSession } from "~/lib/session";

type GameStatus = NonNullable<
    FunctionReturnType<typeof api.game.getGame>
>["status"];

// `/game` is one route with four faces; the title names the one on screen.
// Exhaustive by construction — a new status is a type error here, not a
// silently generic tab.
const GAME_STATUS_TITLE: Record<GameStatus, string> = {
    waiting: "Waiting for Opponent",
    pregame: "Pregame",
    playing: "Game",
    finished: "Game Over",
};

export default function GameRoute() {
    const navigate = useNavigate();
    // The GRE board's own layout hint (issue #2594): a portrait phone gets a
    // fully-designed layout already (the bottom bar + sheet), so this is
    // discoverability for the wide landscape stack-right-panel layout
    // (#2639), never a broken-state warning.
    const viewportMode = useViewportMode();
    const [session, setSession] = useState(() => getStoredSession());

    // Who may open the debug sheet (issue #3403): a tester in any build, and
    // whoever is signed in to a dev build. The predicate is cosmetic — every
    // action inside the sheet is gated on its own server-side mutation — but
    // it is what keeps a regular player's board free of the toggle.
    const currentUser = useCurrentUser();
    const showDebugSheet = import.meta.env.DEV || canUseDebugSheet(currentUser);

    const pageVisible = usePageVisible();
    // Resilient (issue #3266 review): this read decides WHICH of the route's
    // four faces renders, and it sits ABOVE `<Board>` — a re-thrown timeout
    // here tears down the whole route, board included, past the same missing
    // error boundary the fix inside the board exists to stop reaching.
    const game = useResilientQuery(
        api.game.getGame,
        pageVisible && session.gameId ? { gameId: session.gameId } : "skip"
    ).data;
    const leaveGame = useMutation(api.game.leaveGame);

    useEffect(() => {
        if (!session.gameId || !session.playerId) {
            void navigate({ to: "/", replace: true });
        }
    }, [session, navigate]);

    // The board is one route with four faces; the title names the one on
    // screen. Above the early returns, as the hook must run every render.
    useDocumentTitle(game ? GAME_STATUS_TITLE[game.status] : "Game");

    const handleLeave = () => {
        // Delete the abandoned waiting room server-side so the user is free to
        // create another game (#155). Only reachable from the "waiting" screen.
        if (session.gameId) void leaveGame({ gameId: session.gameId });
        clearSession();
        setSession({ gameId: null, playerId: null });
        // A withdrawn Limited Event challenge returns to that event's lobby —
        // the general lobby would strand the player away from their pool and
        // the other seats. Non-event games fall through to the effect above,
        // which sends them to "/".
        if (game?.limitedEventId)
            void navigate({
                to: "/limited/$eventId",
                params: { eventId: game.limitedEventId },
                replace: true,
            });
    };

    const handleSwitchGame = (gameId: Id<"games">, playerId: string) => {
        setSession({ gameId, playerId });
    };

    if (!session.gameId || !session.playerId) return null;
    const { gameId, playerId } = session;

    if (game && game.status === "waiting") {
        return (
            <WaitingForOpponent
                gameId={gameId}
                joinCode={game.joinCode}
                onLeave={handleLeave}
            />
        );
    }

    if (game && game.status === "pregame" && game.matchId) {
        // G1 coin-toss + play/draw gate (CR 103.2-103.4). No gameStates row
        // exists yet; the board mounts only once the toss resolves and the game
        // flips to "playing" (reactive re-query).
        return (
            <div className="flex h-dvh flex-col items-center justify-center text-white">
                <PregameDialog matchId={game.matchId} viewerId={playerId} />
            </div>
        );
    }

    if (game && (game.status === "playing" || game.status === "finished")) {
        // ADR 0080 — the ONLY consumer of games.mode: route the manual game
        // to its own board rather than the GRE board.
        if (game.mode === "manual") {
            // A conceded Tabletop game has had its `manualStates` rows deleted
            // by `manualConcedeMatch`, so the container would subscribe to a
            // null state and sit on "Loading..." forever. The result screen
            // replaces the board outright.
            if (game.status === "finished") {
                return (
                    <div className="flex h-dvh flex-col">
                        <ManualGameOverDialog
                            players={game.players}
                            winnerId={game.winner}
                            matchId={game.matchId}
                            viewerId={playerId}
                            onSwitchGame={handleSwitchGame}
                        />
                    </div>
                );
            }
            return (
                <div className="flex h-dvh flex-col">
                    <ManualBoardContainer
                        key={gameId}
                        gameId={gameId}
                        playerId={playerId}
                        solo={game.solo === true}
                    />
                </div>
            );
        }

        return (
            <div className="flex h-dvh flex-col">
                {viewportMode === "portrait" && (
                    <OrientationHint
                        surfaceId="game-board"
                        message="Rotate for the wide landscape board layout."
                    />
                )}
                {/* `flex-1 min-h-0`, not a bare wrapper (issue #2594): Board's
                    OWN root is `h-full` — with the hint band above sharing
                    this flex column, `h-full` must resolve against a sibling
                    with a DEFINITE remaining-space height, the same
                    `flex-1 min-h-0` contract `<main>` uses in
                    `app-shell.tsx`, not against the column's full `h-dvh`
                    (which would make the two siblings compete for space via
                    flex-shrink instead of the hint band simply taking its own
                    content height off the top). */}
                <div className="flex-1 min-h-0">
                    <Board
                        // Key by gameId: switching games (Restart Solo / rematch /
                        // Switch Game) reuses this route, so without a key the board
                        // subtree keeps every per-game client ref from the prior game
                        // (driver dedupe guards, auto-pass seq, zone anchors). Remount
                        // on game change for a clean slate (fixes the bot freezing on
                        // the new game's mulligan after a restart).
                        key={gameId}
                        gameId={gameId}
                        playerId={playerId}
                        solo={game.solo === true}
                        vsAi={game.vsAi === true}
                        // Both debug view modes lost their only toggles with
                        // the seven buttons issue #3403 removed; the board's
                        // props stay (they are read through `GameContext` all
                        // over the board subtree) and are simply always off.
                        showAllCards={false}
                        debugAllActions={false}
                        onSwitchGame={handleSwitchGame}
                    />
                </div>
                {/* The tester debug surface: one left sheet behind a slim
                    edge toggle (issue #3403). */}
                {showDebugSheet && (
                    <DebugSheet
                        gameId={gameId}
                        playerId={playerId}
                        vsAi={game.vsAi === true}
                    />
                )}
            </div>
        );
    }

    return <LoadingScreen />;
}
