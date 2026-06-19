import type { Player } from "~/types/game";
import PlayerGraveyard from "./player-graveyard";
import PlayerLibrary from "./player-library";
import PlayerExile from "./player-exile";

type BoardNextPilesProps = {
    /** Opponent first, viewer second (same ordering as the rest of BoardNext). */
    orderedPlayers: Player[];
};

/** Card piles (graveyard / library / exile) on the spatial board (PRD #249,
 *  slice #255). Rather than reinvent the pile UI, this reuses the existing
 *  {@link PlayerGraveyard} / {@link PlayerLibrary} / {@link PlayerExile}
 *  components — each wraps `CardsPile`, so the collapsed stack AND the expanded
 *  reveal dialog (with inertial scroll, search-library picker, library context
 *  menu) come along unchanged. They keep emitting their
 *  `data-arrow-anchor-{graveyard,exile}` anchors for target arrows.
 *
 *  The classic board lays these out in a flex row inside `PlayerSideRow`; here
 *  they are absolutely positioned in the board corners so the battlefield/hand
 *  spatial zones keep the full width: the viewer's piles sit at the
 *  bottom-right edge, the opponent's mirror to the top-RIGHT (#334), so the
 *  right edge reads as one symmetric control column — opponent piles · stack ·
 *  pod · viewer piles — with both halves symmetric about the midline. View-layer
 *  only — the GRE boundary is untouched. */
export default function BoardNextPiles({
    orderedPlayers,
}: BoardNextPilesProps) {
    const [opponent, me] = orderedPlayers;

    return (
        <>
            {opponent && (
                <div
                    className="absolute right-3 top-3 z-30 flex flex-row-reverse gap-2"
                    data-testid="piles-opponent"
                >
                    <PlayerGraveyard player={opponent} />
                    <PlayerLibrary player={opponent} />
                    <PlayerExile player={opponent} />
                </div>
            )}

            {me && (
                <div
                    className="absolute right-3 bottom-3 z-30 flex flex-row-reverse gap-2"
                    data-testid="piles-player"
                >
                    <PlayerGraveyard player={me} />
                    <PlayerLibrary player={me} />
                    <PlayerExile player={me} />
                </div>
            )}
        </>
    );
}
