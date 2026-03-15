import type { Player } from "~/types/game";
import PlayerLife from "./player-life";
import PlayerBattlefield from "./player-battlefield";

export default function PlayerBoard({ player }: { player: Player }) {
    return (
        <div
            className="flex-1 flex justify-center items-center relative"
            style={{ backgroundColor: player.bgColor }}
        >
            <PlayerLife player={player} />

            <PlayerBattlefield player={player} />
        </div>
    );
}
