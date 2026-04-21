import type { Color } from "~/types/cards";
import { colors } from "~/types/cards";
import type { Player } from "~/types/game";
import { useGameContext } from "~/hooks/useGameContext";

export default function PlayerManaPool({ player }: { player: Player }) {
    const { playerId } = useGameContext();
    const isMe = player.id === playerId;
    const colorsWithMana = colors.filter(
        (color) => (player.manaPool[color] ?? 0) > 0
    );

    if (!colorsWithMana.length) {
        return null;
    }

    // Local player sits at the bottom of the viewport, so the pool hovers above
    // their life cell. The opponent sits at the top with the side-row mirrored
    // (flex-col-reverse): anchor the pool below their life cell so it stays
    // on-screen instead of being clipped above the viewport edge.
    const positionClass = isMe
        ? "left-0 bottom-full mb-2"
        : "right-0 top-full mt-2";

    return (
        <div
            className={`absolute ${positionClass} z-20 inline-flex w-max gap-2 bg-black/60 px-2 py-1 rounded-md whitespace-nowrap`}
        >
            {colorsWithMana.map((color: Color, key) => (
                <div className="flex items-center gap-1 shrink-0" key={key}>
                    <img
                        src={`/img/symbols/${color}.svg`}
                        className="size-5 shrink-0"
                    />
                    <p className="font-bold text-sm text-white">
                        {player.manaPool[color] ?? 0}
                    </p>
                </div>
            ))}
        </div>
    );
}
