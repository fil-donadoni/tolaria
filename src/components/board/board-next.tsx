import type { CSSProperties } from "react";
import { LayoutGroup } from "motion/react";
import type { Player } from "~/types/game";
import type { StackItem } from "~/types/game";
import {
    fanLayout,
    CARD_WIDTH,
    CARD_HEIGHT,
    type Placement,
} from "~/lib/board-layout";
import { useGameContext } from "~/hooks/useGameContext";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import { ArrowHighlightProvider } from "~/hooks/ArrowHighlightProvider";
import BoardNextBattlefield from "./board-next-battlefield";
import BoardNextPlayer from "./board-next-player";
import BoardNextHand from "./board-next-hand";
import BoardNextHandPortrait from "./board-next-hand-portrait";
import BoardNextPiles from "./board-next-piles";
import BoardNextPortraitChips from "./board-next-portrait-chips";
import BoardNextArrows from "./board-next-arrows";
import GameStack from "./game-stack";
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

/** Opponent hand: slimmer backs (≈70% size) tucked higher up so only a small
 *  Arena-style sliver peeks below the top edge. A larger `baseY` pushes the
 *  mirrored fan toward the top edge ({@link mirrorVertical} flips it), and the
 *  shrunk card footprint must match the fan's step math. */
const OPP_HAND_CARD_WIDTH = Math.round(CARD_WIDTH * 0.7);
const OPP_HAND_CARD_HEIGHT = Math.round(CARD_HEIGHT * 0.7);
function opponentHandLayout(
    count: number,
    width: number,
    height: number
): Placement[] {
    return fanLayout({
        count,
        width,
        baseY: height * 0.72,
        cardWidth: OPP_HAND_CARD_WIDTH,
        cardHeight: OPP_HAND_CARD_HEIGHT,
    });
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
    const { playerId: viewerId, combat } = useGameContext();
    // Portrait (#336): the right control column — pile columns + always-on stack
    // panel — collapses to tappable chips so the board uses the full screen.
    // Landscape/desktop keep the spatial piles and the floating stack.
    const isPortrait = useIsPortrait();

    return (
        // A single LayoutGroup spans every zone so a card's shared-layout
        // element (keyed by instance id in SpatialSlot) is matched across zone
        // boundaries — moving hand → battlefield animates the SAME element via a
        // FLIP rather than unmount/remount (#252).
        <ArrowAnchorProvider>
            <ArrowHighlightProvider>
                <LayoutGroup>
                    <div
                        className="absolute inset-0"
                        data-board-variant="next"
                        style={
                            {
                                // Horizontal band reserved on the right edge by the
                                // pile columns (graveyard/library/exile): right-3
                                // (0.75rem) + 3 × --card-w-sm + 2 × gap-2 (1rem).
                                // Life nameplate + hand center within the space that
                                // excludes this band, not the full viewport (#). In
                                // portrait the piles collapse to bottom chips, so the
                                // band is 0 and centering falls back to the viewport.
                                "--right-piles-w": isPortrait
                                    ? "0px"
                                    : "calc(1.75rem + 3 * var(--card-w-sm))",
                            } as CSSProperties
                        }
                    >
                        {/* Opponent: hand on the top edge, battlefield below it — same
                    layout math, mirrored to the top half. */}
                        {opponent && (
                            <>
                                <BoardNextPlayer player={opponent} side="top" />
                                <div className="absolute left-0 right-[var(--right-piles-w)] top-0 h-[18%]">
                                    {isPortrait ? (
                                        <BoardNextHandPortrait
                                            player={opponent}
                                            interactive={
                                                opponent.id === viewerId
                                            }
                                            data-testid="zone-opponent-hand"
                                        />
                                    ) : (
                                        <BoardNextHand
                                            player={opponent}
                                            interactive={
                                                opponent.id === viewerId
                                            }
                                            layout={opponentHandLayout}
                                            cardWidth={OPP_HAND_CARD_WIDTH}
                                            cardHeight={OPP_HAND_CARD_HEIGHT}
                                            mirror
                                            data-testid="zone-opponent-hand"
                                        />
                                    )}
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
                                <div
                                    className={
                                        isPortrait
                                            ? // Lifted clear of the pile chips
                                              // (bottom-24) + the bottom action
                                              // bar (#335) so the hand stays
                                              // fully thumb-reachable.
                                              "absolute left-0 right-0 bottom-32 h-[16%]"
                                            : "absolute left-0 right-[var(--right-piles-w)] bottom-0 h-[18%]"
                                    }
                                >
                                    {isPortrait ? (
                                        <BoardNextHandPortrait
                                            player={me}
                                            interactive={me.id === viewerId}
                                            data-testid="zone-player-hand"
                                        />
                                    ) : (
                                        <BoardNextHand
                                            player={me}
                                            interactive={me.id === viewerId}
                                            layout={handLayout}
                                            data-testid="zone-player-hand"
                                        />
                                    )}
                                </div>
                            </>
                        )}

                        {/* Card piles (graveyard / library / exile) for both seats.
                    Landscape/desktop reuse the spatial pile columns (#255);
                    portrait collapses them — and the stack — into tappable
                    chips that open the SAME reveal / stack views (#336). */}
                        {isPortrait ? (
                            <BoardNextPortraitChips
                                orderedPlayers={orderedPlayers}
                                stackItems={stackItems}
                            />
                        ) : (
                            <BoardNextPiles orderedPlayers={orderedPlayers} />
                        )}

                        {/* Spatial chrome shared with the classic board. The
                    controller pod (phase + priority cue + actions) is mounted
                    by the Board orchestrator on the right edge (#331). */}
                        <PriorityIndicator />
                        {/* Portrait toggles the stack behind a chip (above);
                    landscape/desktop keep it always-on. */}
                        {!isPortrait && stackItems.length > 0 && (
                            <GameStack stack={stackItems} />
                        )}
                        {/* Our own SVG target arrows (replaces leader-line on the new
                    board, #257): endpoints derive from the shared layout
                    placements via the arrow-anchor registry, so arrows stay
                    glued through the spring/tilt motion. */}
                        <BoardNextArrows stack={stackItems} combat={combat} />
                    </div>
                </LayoutGroup>
            </ArrowHighlightProvider>
        </ArrowAnchorProvider>
    );
}
