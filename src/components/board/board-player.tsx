import type { Player } from "~/types/game";
import { usePlayerInteraction } from "~/hooks/usePlayerInteraction";
import PlayerNameplate from "./player-nameplate";
import PlayerManaPool from "./player-mana-pool";

type BoardPlayerProps = {
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
export default function BoardPlayer({ player, side }: BoardPlayerProps) {
    const interaction = usePlayerInteraction(player);
    // Relative wrapper so the floating mana-pool indicator anchors to the
    // nameplate (its absolute `bottom-full` / `top-full` need a positioned
    // ancestor), mirroring how the classic `player-side-row` pairs the pool with
    // the life cell. Without it the pool — restored here — has nothing to hang
    // off and would be clipped to the viewport edge.
    return (
        <div
            className={`absolute left-[calc(50%-var(--right-piles-w,0)/2)] -translate-x-1/2 z-10 ${
                side === "top" ? "top-1" : "bottom-1"
            }`}
        >
            <PlayerManaPool player={player} />
            <PlayerNameplate player={player} interaction={interaction} />
        </div>
    );
}
