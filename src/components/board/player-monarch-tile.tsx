import type { Player } from "~/types/game";
import { MONARCH_DESIGNATION } from "@convex/cards/designations";
import { useGameContext } from "~/hooks/useGameContext";
import BoardDesignation from "./board-designation";

/** The Monarch designation (CR 725, issue #1199) rendered as a marker-card
 *  tile beside the library/graveyard/exile/emblem piles (`board-piles.tsx`) —
 *  the emblem-style treatment that replaces the old inline crown badge on the
 *  nameplate (#1305). Reads `monarchId` from the shared {@link useGameContext}
 *  (never prop-drilled GameState) and renders the tile only for the single
 *  player who currently holds the designation; renders nothing otherwise, so it
 *  adds no chrome until someone becomes the monarch. */
export default function PlayerMonarchTile({ player }: { player: Player }) {
    const { monarchId } = useGameContext();
    if (monarchId !== player.id) return null;

    return (
        <div className="relative w-(--card-w-sm) aspect-5/7">
            <BoardDesignation
                designation={MONARCH_DESIGNATION}
                testId={`monarch-tile-${player.id}`}
            />
        </div>
    );
}
