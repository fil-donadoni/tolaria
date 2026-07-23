import type { Player } from "~/types/game";
import { CITY_BLESSING_DESIGNATION } from "@convex/cards/designations";
import { useGameContext } from "~/hooks/useGameContext";
import BoardDesignation from "./board-designation";

/** The City's Blessing designation (CR 702.131 Ascend, issue #1460) rendered as
 *  a marker-card tile beside the library/graveyard/exile/emblem/monarch piles
 *  (`board-piles.tsx`) — the direct sibling of {@link PlayerMonarchTile}, using
 *  the same emblem-style {@link BoardDesignation} treatment. Reads
 *  `cityBlessingIds` from the shared {@link useGameContext} (never prop-drilled
 *  GameState) and renders the tile only for a player who currently holds the
 *  designation; renders nothing otherwise. Unlike the monarch tile, the
 *  designation is NON-exclusive, so both players' tiles can show at once. */
export default function PlayerCityBlessingTile({ player }: { player: Player }) {
    const { cityBlessingIds } = useGameContext();
    if (!cityBlessingIds?.includes(player.id)) return null;

    return (
        <div className="relative w-(--card-w-sm) aspect-5/7">
            <BoardDesignation
                designation={CITY_BLESSING_DESIGNATION}
                testId={`city-blessing-tile-${player.id}`}
            />
        </div>
    );
}
