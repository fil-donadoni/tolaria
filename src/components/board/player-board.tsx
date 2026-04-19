import type { Player } from "~/types/game";
import PlayerBattlefield from "./player-battlefield";
import PlayerSideRow from "./player-side-row";
import { useGameContext } from "~/hooks/useGameContext";

export default function PlayerBoard({ player }: { player: Player }) {
    const { playerId } = useGameContext();
    const isMe = player.id === playerId;

    return (
        <div
            className="flex-1 flex flex-col relative overflow-hidden min-h-0"
            style={{ backgroundColor: player.bgColor }}
        >
            <div
                className={`flex-1 flex flex-col min-h-0 ${isMe ? "" : "flex-col-reverse"}`}
            >
                <PlayerBattlefield player={player} />
                <PlayerSideRow player={player} />
            </div>
        </div>
    );
}
