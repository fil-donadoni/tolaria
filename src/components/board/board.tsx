import { useState } from "react";
import type { Player } from "~/types/game";
import PlayerBoard from "./player-board";
import { startingPlayers } from "~/mocks/startingPlayers";

export default function Board() {
    const [players] = useState<Player[]>(startingPlayers);
    return (
        <div className="w-full h-full flex flex-col">
            {players.map((player, index) => (
                <PlayerBoard key={index} player={player} />
            ))}
        </div>
    );
}
