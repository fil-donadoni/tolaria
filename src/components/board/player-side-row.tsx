import type { Player } from "~/types/game";
import PlayerLife from "./player-life";
import PlayerHand from "./player-hand";
import PlayerLibrary from "./player-library";
import PlayerGraveyard from "./player-graveyard";
import PlayerExile from "./player-exile";
import PlayerManaPool from "./player-mana-pool";
import { useGameContext } from "~/hooks/useGameContext";

export default function PlayerSideRow({ player }: { player: Player }) {
    const { playerId } = useGameContext();
    const isMe = player.id === playerId;

    const lifeCell = (
        <div
            className={`relative ${isMe ? "justify-self-start" : "justify-self-end"}`}
        >
            <PlayerManaPool player={player} />
            <PlayerLife player={player} />
        </div>
    );

    const pilesCell = (
        <div
            className={`flex gap-2 ${isMe ? "justify-self-end flex-row-reverse" : "justify-self-start"}`}
        >
            <PlayerGraveyard player={player} />
            <PlayerLibrary player={player} />
            <PlayerExile player={player} />
        </div>
    );

    return (
        <div
            className={`grid grid-cols-[1fr_auto_1fr] gap-2 px-4 shrink-0 ${isMe ? "items-end pt-2 pb-14" : "items-start pt-2 pb-2"}`}
        >
            {isMe ? lifeCell : pilesCell}
            <div className="flex justify-center min-w-0">
                <PlayerHand player={player} />
            </div>
            {isMe ? pilesCell : lifeCell}
        </div>
    );
}
