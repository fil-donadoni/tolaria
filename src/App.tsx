import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import Board from "./components/board/board";
import { startingPlayers } from "./mocks/startingPlayers";

function App() {
    const [gameId, setGameId] = useState<Id<"games"> | null>(
        () => localStorage.getItem("tolaria:gameId") as Id<"games"> | null
    );
    const initGame = useMutation(api.game.initGame);

    const handleNewGame = async () => {
        const id = await initGame({
            name: "Dev Game",
            players: startingPlayers.map((p) => ({
                id: p.id,
                name: p.name,
                bgColor: p.bgColor,
                deck: p.deck,
            })),
        });
        localStorage.setItem("tolaria:gameId", id);
        setGameId(id);
    };

    if (!gameId) {
        return (
            <div className="flex h-screen items-center justify-center">
                <button
                    onClick={handleNewGame}
                    className="rounded bg-black/80 px-6 py-3 text-lg text-white hover:bg-black/60"
                >
                    New Game
                </button>
            </div>
        );
    }

    return (
        <div className="flex h-screen flex-col">
            <Board gameId={gameId} />
        </div>
    );
}

export default App;
