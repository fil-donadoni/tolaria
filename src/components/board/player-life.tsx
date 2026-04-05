import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";

type PlayerLifeProps = {
    player: Player;
};

export default function PlayerLife({ player }: PlayerLifeProps) {
    const { playerId } = useGameContext();
    const isMe = player.id === playerId;

    return (
        <div
            className={`bg-slate-900 text-white text-center p-4 rounded-md absolute left-1/2 -translate-x-1/2 ${isMe ? "bottom-4" : "top-4"}`}
        >
            <h2 className="text-5xl font-bold text-center">{player.life}</h2>
            <p>{player.name}</p>
        </div>
    );
}
