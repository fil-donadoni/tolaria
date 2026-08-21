import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Board from "~/components/board/board";
import ManualBoardContainer from "~/components/board/manual-board-container";
import ManualGameOverDialog from "~/components/board/manual-game-over-dialog";
import PregameDialog from "~/components/board/pregame-dialog";
import DebugPanel from "~/components/debug/debug-panel";
import AiDecisionTraceBox from "~/components/debug/ai-decision-trace-box";
import DevPanelRail from "~/components/debug/dev-panel-rail";
import LoadingScreen from "~/components/ui/loading-screen";
import WaitingForOpponent from "~/components/board/waiting-for-opponent";
import OrientationHint from "~/components/ui/orientation-hint";
import { useDocumentTitle } from "~/hooks/useDocumentTitle";
import { usePageVisible } from "~/hooks/usePageVisible";
import { useViewportMode } from "~/hooks/useViewportMode";
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
    const [showAllCards, setShowAllCards] = useState(false);
    const [debugAllActions, setDebugAllActions] = useState(false);

    const pageVisible = usePageVisible();
    const game = useQuery(
        api.game.getGame,
        pageVisible && session.gameId ? { gameId: session.gameId } : "skip"
    );
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
                        showAllCards={showAllCards}
                        debugAllActions={debugAllActions}
                        onSwitchGame={handleSwitchGame}
                    />
                </div>
                {/* One left rail for every DEV overlay — it owns the anchoring
                    so the panels stack instead of overlapping. */}
                {import.meta.env.DEV && (
                    <DevPanelRail>
                        {game.vsAi === true && <AiDecisionTraceBox />}
                        <DebugPanel
                            gameId={gameId}
                            playerId={playerId}
                            showAllCards={showAllCards}
                            onToggleShowAllCards={() =>
                                setShowAllCards((v) => !v)
                            }
                            debugAllActions={debugAllActions}
                            onToggleDebugAllActions={() =>
                                setDebugAllActions((v) => !v)
                            }
                            onSwitchGame={handleSwitchGame}
                        />
                    </DevPanelRail>
                )}
            </div>
        );
    }

    return <LoadingScreen />;
}
