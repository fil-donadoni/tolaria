import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Board from "./components/board/board";
import DebugPanel from "./components/debug/debug-panel";
import { usePageVisible } from "./hooks/usePageVisible";
import { whiteWeenieDeck } from "./mocks/startingPlayers";

const PLAYER_COLORS = ["#4B5A6C", "#63768D"];

function getStoredSession() {
    const gameId = localStorage.getItem("tolaria:gameId") as Id<"games"> | null;
    const playerId = localStorage.getItem("tolaria:playerId");
    return { gameId, playerId };
}

function storeSession(gameId: Id<"games">, playerId: string) {
    localStorage.setItem("tolaria:gameId", gameId);
    localStorage.setItem("tolaria:playerId", playerId);
}

function clearSession() {
    localStorage.removeItem("tolaria:gameId");
    localStorage.removeItem("tolaria:playerId");
}

function App() {
    const stored = getStoredSession();
    const [gameId, setGameId] = useState<Id<"games"> | null>(stored.gameId);
    const [playerId, setPlayerId] = useState<string | null>(stored.playerId);
    const [playerName, setPlayerName] = useState(
        () => localStorage.getItem("tolaria:playerName") ?? ""
    );
    const [showAllCards, setShowAllCards] = useState(false);
    const [debugAllActions, setDebugAllActions] = useState(false);

    const pageVisible = usePageVisible();
    const createGame = useMutation(api.game.createGame);
    const joinGame = useMutation(api.game.joinGame);
    const openGames = useQuery(
        api.game.listOpenGames,
        pageVisible ? {} : "skip"
    );
    const game = useQuery(
        api.game.getGame,
        pageVisible && gameId ? { gameId } : "skip"
    );

    const handleCreate = async () => {
        const name = playerName.trim() || "Player 1";
        const pid = crypto.randomUUID();
        const id = await createGame({
            name: `${name}'s game`,
            player: {
                id: pid,
                name,
                bgColor: PLAYER_COLORS[0],
                deck: whiteWeenieDeck,
            },
        });
        localStorage.setItem("tolaria:playerName", name);
        storeSession(id, pid);
        setGameId(id);
        setPlayerId(pid);
    };

    const handleJoin = async (targetGameId: Id<"games">) => {
        const name = playerName.trim() || "Player 2";
        const pid = crypto.randomUUID();
        await joinGame({
            gameId: targetGameId,
            player: {
                id: pid,
                name,
                bgColor: PLAYER_COLORS[1],
                deck: whiteWeenieDeck,
            },
        });
        localStorage.setItem("tolaria:playerName", name);
        storeSession(targetGameId, pid);
        setGameId(targetGameId);
        setPlayerId(pid);
    };

    const handleLeave = () => {
        clearSession();
        setGameId(null);
        setPlayerId(null);
    };

    // In a game
    if (gameId && playerId) {
        // Waiting for opponent
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

        // Playing
        if (game && game.status === "playing") {
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

    // Lobby
    return (
        <div className="flex h-screen flex-col items-center justify-center gap-6 text-white">
            <h1 className="text-2xl font-bold">Tolaria</h1>

            <input
                type="text"
                placeholder="Your name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                className="rounded border border-white/20 bg-white/5 px-4 py-2 text-center text-white placeholder:text-white/30"
            />

            <button
                onClick={handleCreate}
                className="rounded bg-white/10 px-6 py-3 text-lg hover:bg-white/20"
            >
                Create Game
            </button>

            {openGames && openGames.length > 0 && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-white/50">Open games:</p>
                    {openGames.map((g) => (
                        <button
                            key={g._id}
                            onClick={() => handleJoin(g._id)}
                            className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
                        >
                            {g.name} ({g.players.length}/2)
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default App;
