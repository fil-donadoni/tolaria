import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Board from "./components/board/board";
import DebugPanel from "./components/debug/debug-panel";
import Lobby from "./components/lobby/lobby";
import { usePageVisible } from "./hooks/usePageVisible";
import { clearSession, getStoredSession } from "./lib/session";

function App() {
    const stored = getStoredSession();
    const [gameId, setGameId] = useState<Id<"games"> | null>(stored.gameId);
    const [playerId, setPlayerId] = useState<string | null>(stored.playerId);
    const [showAllCards, setShowAllCards] = useState(false);
    const [debugAllActions, setDebugAllActions] = useState(false);

    const pageVisible = usePageVisible();
    const game = useQuery(
        api.game.getGame,
        pageVisible && gameId ? { gameId } : "skip"
    );

    const handleEnter = (id: Id<"games">, pid: string) => {
        setGameId(id);
        setPlayerId(pid);
    };

    const handleLeave = () => {
        clearSession();
        setGameId(null);
        setPlayerId(null);
    };

    if (gameId && playerId) {
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
                        showAllCards={showAllCards}
                        debugAllActions={debugAllActions}
                    />
                    {import.meta.env.DEV && (
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

    return <Lobby onEnter={handleEnter} />;
}

export default App;
