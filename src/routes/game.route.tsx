import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Board from "~/components/board/board";
import DebugPanel from "~/components/debug/debug-panel";
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

    useEffect(() => {
        if (!session.gameId || !session.playerId) {
            void navigate({ to: "/", replace: true });
        }
    }, [session, navigate]);

    const handleLeave = () => {
        clearSession();
        setSession({ gameId: null, playerId: null });
    };

    const handleSwitchGame = (gameId: Id<"games">, playerId: string) => {
        setSession({ gameId, playerId });
    };

    if (!session.gameId || !session.playerId) return null;
    const { gameId, playerId } = session;

    if (game && game.status === "waiting") {
        return (
            <div className="flex h-screen flex-col items-center justify-center gap-4 text-white">
                <p>Waiting for opponent...</p>
                <p className="font-mono text-sm text-white/50">
                    Game ID: {gameId}
                </p>
                <button
                    onClick={handleLeave}
                    className="rounded bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
                >
                    Leave
                </button>
            </div>
        );
    }

    if (game && (game.status === "playing" || game.status === "finished")) {
        return (
            <div className="flex h-screen flex-col">
                <Board
                    gameId={gameId}
                    playerId={playerId}
                    solo={game.solo === true}
                    showAllCards={showAllCards}
                    debugAllActions={debugAllActions}
                />
                {import.meta.env.DEV && (
                    <DebugPanel
                        gameId={gameId}
                        showAllCards={showAllCards}
                        onToggleShowAllCards={() => setShowAllCards((v) => !v)}
                        debugAllActions={debugAllActions}
                        onToggleDebugAllActions={() =>
                            setDebugAllActions((v) => !v)
                        }
                        onSwitchGame={handleSwitchGame}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="flex h-screen items-center justify-center text-white">
            Loading...
        </div>
    );
}
