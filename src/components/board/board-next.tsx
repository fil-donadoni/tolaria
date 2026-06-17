import { LayoutGroup } from "motion/react";
import type { Player } from "~/types/game";
import type { StackItem } from "~/types/game";
import { rowLayout, fanLayout, type Placement } from "~/lib/board-layout";
import SpatialZone, { type SpatialItem } from "./spatial-zone";
import BoardNextCard from "./board-next-card";
import GameStack from "./game-stack";
import PhaseTracker from "./phase-tracker";
import PriorityIndicator from "./priority-indicator";
import TargetArrowsOverlay from "./target-arrows-overlay";

type BoardNextProps = {
    /** Opponent first, viewer second (same ordering as the classic board). */
    orderedPlayers: Player[];
    stackItems: StackItem[];
};

/** Battlefield row: full size + gap until overflow, then overlap, then scale.
 *  Vertically centered in its zone (`rowLayout`, #251). */
function battlefieldLayout(
    count: number,
    width: number,
    height: number
): Placement[] {
    return rowLayout({ count, width, centerY: height / 2 });
}

/** Hand: shallow fanned arc, baseline near the bottom of its zone so the dome
 *  lifts upward into view (`fanLayout`, #251). */
function handLayout(count: number, width: number, height: number): Placement[] {
    return fanLayout({ count, width, baseY: height * 0.6 });
}

/** Maps a battlefield (always-visible instances) to placeable slots. */
function battlefieldItems(player: Player): SpatialItem[] {
    return player.battlefield.map((card) => ({
        key: card.id,
        node: <BoardNextCard card={card} />,
    }));
}

/** Maps a hand to placeable slots. Opponent slots are `null` (hidden) and
 *  render as backs; the viewer's own hand carries full instances. */
function handItems(player: Player): SpatialItem[] {
    return player.hand.map((card, i) => ({
        key: card ? card.id : `hidden-${player.id}-${i}`,
        node: <BoardNextCard card={card} />,
    }));
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

    return (
        // A single LayoutGroup spans every zone so a card's shared-layout
        // element (keyed by instance id in SpatialSlot) is matched across zone
        // boundaries — moving hand → battlefield animates the SAME element via a
        // FLIP rather than unmount/remount (#252).
        <LayoutGroup>
            <div className="absolute inset-0" data-board-variant="next">
                {/* Opponent: hand on the top edge, battlefield below it — same
                    layout math, mirrored to the top half. */}
                {opponent && (
                    <>
                        <div className="absolute left-0 right-0 top-0 h-[18%]">
                            <SpatialZone
                                items={handItems(opponent)}
                                layout={handLayout}
                                mirror
                                data-testid="zone-opponent-hand"
                            />
                        </div>
                        <div className="absolute left-0 right-0 top-[18%] h-[32%]">
                            <SpatialZone
                                items={battlefieldItems(opponent)}
                                layout={battlefieldLayout}
                                mirror
                                data-testid="zone-opponent-battlefield"
                            />
                        </div>
                    </>
                )}

                {/* Viewer: battlefield on the bottom half, hand on the bottom edge. */}
                {me && (
                    <>
                        <div className="absolute left-0 right-0 top-1/2 h-[32%]">
                            <SpatialZone
                                items={battlefieldItems(me)}
                                layout={battlefieldLayout}
                                data-testid="zone-player-battlefield"
                            />
                        </div>
                        <div className="absolute left-0 right-0 bottom-0 h-[18%]">
                            <SpatialZone
                                items={handItems(me)}
                                layout={handLayout}
                                data-testid="zone-player-hand"
                            />
                        </div>
                    </>
                )}

                {/* Spatial chrome shared with the classic board. */}
                <PriorityIndicator />
                <PhaseTracker />
                {stackItems.length > 0 && <GameStack stack={stackItems} />}
                <TargetArrowsOverlay stack={stackItems} />
            </div>
        </LayoutGroup>
    );
}
