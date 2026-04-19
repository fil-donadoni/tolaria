import type { Color } from "~/types/cards";
import { colors } from "~/types/cards";
import type { Player } from "~/types/game";

export default function PlayerManaPool({ player }: { player: Player }) {
    const colorsWithMana = colors.filter((color) => player.manaPool[color] > 0);

    if (!colorsWithMana.length) {
        return null;
    }

    return (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-20 inline-flex w-max gap-2 bg-black/60 px-2 py-1 rounded-md whitespace-nowrap">
            {colorsWithMana.map((color: Color, key) => (
                <div className="flex items-center gap-1 shrink-0" key={key}>
                    <img
                        src={`/img/symbols/${color}.svg`}
                        className="size-5 shrink-0"
                    />
                    <p className="font-bold text-sm text-white">
                        {player.manaPool[color]}
                    </p>
                </div>
            ))}
        </div>
    );
}
