import type { Player } from "~/types/game";
import type { PlayerInteraction } from "~/hooks/usePlayerInteraction";

type PlayerNameplateProps = {
    player: Player;
    interaction: PlayerInteraction;
    /** Extra classes appended by the layout (e.g. absolute positioning on the
     *  spatial board). */
    className?: string;
};

/** Presentational life total + nameplate shared by the classic life chrome
 *  (`player-life.tsx`) and the spatial board (`board-next-player.tsx`), slice
 *  #280. Renders the seat-coloured priority ring and the targeting /
 *  damage-choice ring from the flags computed by {@link usePlayerInteraction};
 *  the click handler is wired by the caller via `interaction.handleClick`.
 *
 *  Carries `data-arrow-anchor-player` so a spell/ability that targets a player
 *  (e.g. Lightning Bolt to the face) can attach its arrow
 *  (`target-arrows-overlay.tsx` / `board-next-arrows.tsx`). */
export default function PlayerNameplate({
    player,
    interaction,
    className = "",
}: PlayerNameplateProps) {
    const { isMe, hasPriority, isTargetable, isDamageTargetPickable } =
        interaction;

    // Colour the nameplate ring by seat (#152): emerald when it's the local
    // player, amber for the opponent — matching the board-edge PriorityIndicator.
    const priorityRing = hasPriority
        ? isMe
            ? "ring-2 ring-emerald-400"
            : "ring-2 ring-amber-400"
        : "";

    const ringClass = isTargetable
        ? "ring-2 ring-orange-400 cursor-pointer hover:ring-orange-300"
        : isDamageTargetPickable
          ? interaction.isPlayerPicked
              ? "ring-2 ring-orange-500 cursor-pointer"
              : "ring-2 ring-orange-400 cursor-pointer hover:ring-orange-300"
          : "";

    return (
        <div
            data-arrow-anchor-player={player.id}
            className={`bg-slate-900 text-white text-center px-3 py-2 rounded-md shrink-0 ${priorityRing} ${ringClass} ${className}`}
            onClick={interaction.handleClick}
        >
            <h2 className="text-3xl font-bold leading-tight">{player.life}</h2>
            <p className="text-xs">{player.name}</p>
        </div>
    );
}
