import { useGameContext } from "~/hooks/useGameContext";
import type { Color } from "~/types/cards";
import { colors } from "~/types/cards";
import type { Player } from "~/types/game";

export default function PlayerManaPool({ player }: { player: Player }) {
    const { playerId } = useGameContext();
    const isMe = player.id === playerId;

    const colorsWithMana = colors.filter((color) => player.manaPool[color] > 0);

    return (
        <div
            className={`z-20 flex gap-2 bg-black/40 p-2 rounded-md absolute left-1/2 -translate-x-1/2 ${isMe ? "bottom-32" : "top-48"}`}
        >
            {colorsWithMana.map((color: Color, key) => (
                <div className="flex flex-col items-center gap-2" key={key}>
                    <img src={`/img/symbols/${color}.svg`} className="size-6" />

                    <p className="font-bold">{player.manaPool[color]}</p>
                </div>
            ))}
        </div>
    );
}
