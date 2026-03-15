import type { Player } from "~/types/game";

type PlayerLifeProps = {
    player: Player;
};

export default function PlayerLife({ player }: PlayerLifeProps) {
    return (
        <div
            className={`bg-slate-900 text-white p-4 rounded-md absolute left-1/2 -translate-x-1/2 ${player.id === "1" ? "top-4" : "bottom-4"}`}
        >
            <h2 className="text-5xl font-bold text-center">{player.life}</h2>
        </div>
    );
}
