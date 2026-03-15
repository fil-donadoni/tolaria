import type { Player } from "~/types/game";
import PlayerLife from "./player-life";
import PlayerBattlefield from "./player-battlefield";
import PlayerHand from "./player-hand";

export default function PlayerBoard({ player }: { player: Player }) {
    return (
        <div
            className="flex-1 flex justify-center items-center relative overflow-hidden"
            style={{ backgroundColor: player.bgColor }}
        >
            <PlayerHand player={player} />

            <PlayerLife player={player} />

            <PlayerBattlefield player={player} />
        </div>
    );
}
