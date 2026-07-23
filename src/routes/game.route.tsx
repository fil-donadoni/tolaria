import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Board from "~/components/board/board";
import PregameDialog from "~/components/board/pregame-dialog";
import DebugPanel from "~/components/debug/debug-panel";
import AiDecisionTraceBox from "~/components/debug/ai-decision-trace-box";
import DevPanelRail from "~/components/debug/dev-panel-rail";
import LoadingScreen from "~/components/ui/loading-screen";
import WaitingForOpponent from "~/components/board/waiting-for-opponent";
import { usePageVisible } from "~/hooks/usePageVisible";
import { clearSession, getStoredSession } from "~/lib/session";

export default function GameRoute() {
    const navigate = useNavigate();
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

    const handleLeave = () => {
        // Delete the abandoned waiting room server-side so the user is free to
        // create another game (#155). Only reachable from the "waiting" screen.
        if (session.gameId) void leaveGame({ gameId: session.gameId });
        clearSession();
        setSession({ gameId: null, playerId: null });
    };

    const handleSwitchGame = (gameId: Id<"games">, playerId: string) => {
        setSession({ gameId, playerId });
    };

    if (!session.gameId || !session.playerId) return null;
    const { gameId, playerId } = session;

    if (game && game.status === "waiting") {
        return <WaitingForOpponent gameId={gameId} onLeave={handleLeave} />;
    }

    if (game && game.status === "pregame" && game.matchId) {
        // G1 coin-toss + play/draw gate (CR 103.2-103.4). No game_states row
        // exists yet; the board mounts only once the toss resolves and the game
        // flips to "playing" (reactive re-query).
        return (
            <div className="flex h-dvh flex-col items-center justify-center text-white">
                <PregameDialog matchId={game.matchId} viewerId={playerId} />
            </div>
        );
    }

    if (game && (game.status === "playing" || game.status === "finished")) {
        return (
            <div className="flex h-dvh flex-col">
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
                {/* One left rail for every DEV overlay — it owns the anchoring
                    so the panels stack instead of overlapping. */}
                {import.meta.env.DEV && (
                    <DevPanelRail>
                        {game.vsAi === true && <AiDecisionTraceBox />}
                        <DebugPanel
                            gameId={gameId}
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
