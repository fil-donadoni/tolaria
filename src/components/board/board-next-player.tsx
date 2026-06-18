import type { Player } from "~/types/game";
import { usePlayerInteraction } from "~/hooks/usePlayerInteraction";
import PlayerNameplate from "./player-nameplate";

type BoardNextPlayerProps = {
    player: Player;
    /** Anchor on the top edge (opponent) vs the bottom edge (viewer). */
    side: "top" | "bottom";
};

/** Player-facing chrome for the spatial board (PRD #249, slice #280),
 *  replacing the previously inert player-edge geometry handle. Mounts the
 *  shared {@link PlayerNameplate} (life total + name + priority ring +
 *  targeting / damage-choice ring) positioned at the player's board edge, wired
 *  to the shared {@link usePlayerInteraction} controller so a click dispatches
 *  the SAME `selectTarget` / choice-buffer toggle as the classic
 *  `player-life.tsx`.
 *
 *  The nameplate carries `data-arrow-anchor-player`, so it doubles as the
 *  target-arrow anchor the inert handle used to provide — there is exactly one
 *  anchor element per player, which the arrow publisher
 *  ({@link useDomAnchorPublisher}) measures. */
export default function BoardNextPlayer({
    player,
    side,
}: BoardNextPlayerProps) {
    const interaction = usePlayerInteraction(player);
    return (
        <PlayerNameplate
            player={player}
            interaction={interaction}
            className={`absolute left-1/2 -translate-x-1/2 z-10 ${
                side === "top" ? "top-1" : "bottom-1"
            }`}
        />
    );
}
