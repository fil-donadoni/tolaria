import type { Player } from "~/types/game";
import { usePlayerInteraction } from "~/hooks/usePlayerInteraction";
import { useGameContext } from "~/hooks/useGameContext";
import PlayerNameplate from "./player-nameplate";

type PlayerLifeProps = {
    player: Player;
};

/** Classic-board life total + nameplate. Thin wrapper that wires the shared
 *  {@link usePlayerInteraction} controller (player-as-target / damage-choice
 *  clicks, priority ring) into the shared {@link PlayerNameplate} presentation,
 *  so the spatial board (`board-player.tsx`) renders the same chrome with
 *  the same dispatch (slice #280). */
export default function PlayerLife({ player }: PlayerLifeProps) {
    const interaction = usePlayerInteraction(player);
    // CR 720.1 (issue #1199) — the monarch badge; derived here (not
    // prop-drilled) from the shared GameContext.
    const { monarchId } = useGameContext();
    return (
        <PlayerNameplate
            player={player}
            interaction={interaction}
            isMonarch={monarchId === player.id}
        />
    );
}
