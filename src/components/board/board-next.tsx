import type { Player } from "~/types/game";
import type { StackItem } from "~/types/game";
import PlayerBattlefield from "./player-battlefield";
import PlayerHand from "./player-hand";
import GameStack from "./game-stack";
import PhaseTracker from "./phase-tracker";
import PriorityIndicator from "./priority-indicator";
import TargetArrowsOverlay from "./target-arrows-overlay";

type BoardNextProps = {
    /** Opponent first, viewer second (same ordering as the classic board). */
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** New spatial root — DOM-only board (PRD #249, walking skeleton #250).
 *
 *  This slice establishes the *seam*: it reads the same projected game state
 *  as the classic board and renders both players' battlefield + hand as
 *  simple absolutely-positioned DOM regions. Placement is static — no
 *  auto-layout, fan geometry, 3D tilt, springs, or drag yet (those are later
 *  slices #251–257). Card rendering and interaction are reused wholesale from
 *  the existing `PlayerBattlefield` / `PlayerHand` components, so the GRE
 *  boundary is untouched: this is view-layer only.
 *
 *  All non-spatial chrome (dialogs, banners, action bar, mulligan, combat
 *  panels) is rendered by the parent `Board` orchestrator and works unchanged
 *  on this root. */
export default function BoardNext({
    orderedPlayers,
    stackItems,
}: BoardNextProps) {
    const [opponent, me] = orderedPlayers;

    return (
        <div className="absolute inset-0" data-board-variant="next">
            {/* Opponent: battlefield on the top edge, hand above it (backs). */}
            {opponent && (
                <>
                    <div className="absolute left-0 right-0 top-0 flex justify-center">
                        <PlayerHand player={opponent} />
                    </div>
                    <div className="absolute left-0 right-0 top-[18%] bottom-1/2 overflow-hidden">
                        <PlayerBattlefield player={opponent} />
                    </div>
                </>
            )}

            {/* Viewer: battlefield on the bottom half, hand on the bottom edge. */}
            {me && (
                <>
                    <div className="absolute left-0 right-0 top-1/2 bottom-[18%] overflow-hidden">
                        <PlayerBattlefield player={me} />
                    </div>
                    <div className="absolute left-0 right-0 bottom-0 flex justify-center">
                        <PlayerHand player={me} />
                    </div>
                </>
            )}

            {/* Spatial chrome shared with the classic board. */}
            <PriorityIndicator />
            <PhaseTracker />
            {stackItems.length > 0 && <GameStack stack={stackItems} />}
            <TargetArrowsOverlay stack={stackItems} />
        </div>
    );
}
