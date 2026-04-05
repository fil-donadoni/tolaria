import type { Player } from "~/types/game";
import PlayerLife from "./player-life";
import PlayerBattlefield from "./player-battlefield";
import PlayerHand from "./player-hand";
import PlayerLibrary from "./player-library";
import PlayerGraveyard from "./player-graveyard";
import PlayerExile from "./player-exile";
import { useGameContext } from "~/hooks/useGameContext";
import PlayerManaPool from "./player-mana-pool";

export default function PlayerBoard({ player }: { player: Player }) {
    const { playerId } = useGameContext();
    const isMe = player.id === playerId;

    return (
        <div
            className="flex-1 flex justify-center items-center relative overflow-hidden"
            style={{ backgroundColor: player.bgColor }}
        >
            <PlayerHand player={player} />

            <PlayerLife player={player} />

            <PlayerManaPool player={player} />

            <div
                className={`absolute flex gap-2 ${isMe ? "bottom-4 right-4" : "flex-row-reverse top-4 left-4"}`}
            >
                <PlayerExile player={player} />
                <PlayerLibrary player={player} />
                <PlayerGraveyard player={player} />
            </div>

            <PlayerBattlefield player={player} />
        </div>
    );
}
