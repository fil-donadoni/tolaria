import { LayoutGroup } from "motion/react";
import type { Player } from "~/types/game";
import type { StackItem } from "~/types/game";
import { fanLayout, type Placement } from "~/lib/board-layout";
import { useGameContext } from "~/hooks/useGameContext";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import BoardNextBattlefield from "./board-next-battlefield";
import BoardNextPlayer from "./board-next-player";
import BoardNextHand from "./board-next-hand";
import BoardNextPiles from "./board-next-piles";
import BoardNextArrows from "./board-next-arrows";
import GameStack from "./game-stack";
import PhaseTracker from "./phase-tracker";
import PriorityIndicator from "./priority-indicator";

type BoardNextProps = {
    /** Opponent first, viewer second (same ordering as the classic board). */
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** Hand: shallow fanned arc, baseline near the bottom of its zone so the dome
 *  lifts upward into view (`fanLayout`, #251). */
function handLayout(count: number, width: number, height: number): Placement[] {
    return fanLayout({ count, width, baseY: height * 0.6 });
}

/** New spatial root — DOM-only board (PRD #249). Slice #251 makes the shared
 *  pure layout math (`src/lib/board-layout.ts`) the single source of truth for
 *  card positions: every card in every zone is placed from `rowLayout` /
 *  `fanLayout` output rather than static CSS. Both player and opponent zones use
 *  the same math; the opponent's side is mirrored vertically.
 *
 *  This is a view-layer slice: cards are presentational here (image + back) and
 *  interaction is wired in later slices (#252+), so the GRE boundary is
 *  untouched. All non-spatial chrome (dialogs, banners, action bar, mulligan,
 *  combat panels) is rendered by the parent `Board` orchestrator. */
export default function BoardNext({
    orderedPlayers,
    stackItems,
}: BoardNextProps) {
    const [opponent, me] = orderedPlayers;
    // The viewer's own hand is interactive (drag-to-cast / play, #254); every
    // other hand stays presentational. `playerId` is the current viewer seat
    // (the solo viewer auto-follows priority, set by the Board orchestrator).
    const { playerId: viewerId } = useGameContext();

    return (
        // A single LayoutGroup spans every zone so a card's shared-layout
        // element (keyed by instance id in SpatialSlot) is matched across zone
        // boundaries — moving hand → battlefield animates the SAME element via a
        // FLIP rather than unmount/remount (#252).
        <ArrowAnchorProvider>
            <LayoutGroup>
                <div className="absolute inset-0" data-board-variant="next">
                    {/* Opponent: hand on the top edge, battlefield below it — same
                    layout math, mirrored to the top half. */}
                    {opponent && (
                        <>
                            <BoardNextPlayer player={opponent} side="top" />
                            <div className="absolute left-0 right-0 top-0 h-[18%]">
                                <BoardNextHand
                                    player={opponent}
                                    interactive={opponent.id === viewerId}
                                    layout={handLayout}
                                    mirror
                                    data-testid="zone-opponent-hand"
                                />
                            </div>
                            <div className="absolute left-0 right-0 top-[18%] h-[32%]">
                                <BoardNextBattlefield
                                    player={opponent}
                                    mirror
                                    data-testid="zone-opponent-battlefield"
                                />
                            </div>
                        </>
                    )}

                    {/* Viewer: battlefield on the bottom half, hand on the bottom edge. */}
                    {me && (
                        <>
                            <BoardNextPlayer player={me} side="bottom" />
                            <div className="absolute left-0 right-0 top-1/2 h-[32%]">
                                <BoardNextBattlefield
                                    player={me}
                                    data-testid="zone-player-battlefield"
                                />
                            </div>
                            <div className="absolute left-0 right-0 bottom-0 h-[18%]">
                                <BoardNextHand
                                    player={me}
                                    interactive={me.id === viewerId}
                                    layout={handLayout}
                                    data-testid="zone-player-hand"
                                />
                            </div>
                        </>
                    )}

                    {/* Card piles (graveyard / library / exile) for both seats,
                    reusing the existing pile components incl. their expanded
                    reveal + inertial scroll (#255). */}
                    <BoardNextPiles orderedPlayers={orderedPlayers} />

                    {/* Spatial chrome shared with the classic board. */}
                    <PriorityIndicator />
                    <PhaseTracker />
                    {stackItems.length > 0 && <GameStack stack={stackItems} />}
                    {/* Our own SVG target arrows (replaces leader-line on the new
                    board, #257): endpoints derive from the shared layout
                    placements via the arrow-anchor registry, so arrows stay
                    glued through the spring/tilt motion. */}
                    <BoardNextArrows stack={stackItems} />
                </div>
            </LayoutGroup>
        </ArrowAnchorProvider>
    );
}
