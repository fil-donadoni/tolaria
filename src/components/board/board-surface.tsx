import type { CSSProperties } from "react";
import { LayoutGroup } from "motion/react";
import type { Combat, Player, StackItem } from "~/types/game";
import {
    PORTRAIT_OPPONENT_BATTLEFIELD_BAND,
    PORTRAIT_OPPONENT_HAND_BAND,
    PORTRAIT_VIEWER_BATTLEFIELD_BAND,
    PORTRAIT_VIEWER_HAND_BAND,
    portraitBandVars,
} from "~/lib/portrait-board-bands";
import {
    LANDSCAPE_OPPONENT_BATTLEFIELD_BAND,
    LANDSCAPE_OPPONENT_HAND_BAND,
    LANDSCAPE_VIEWER_BATTLEFIELD_BAND,
    LANDSCAPE_VIEWER_HAND_BAND,
    landscapeBandVars,
    type LandscapeCardMetrics,
} from "~/lib/landscape-board-bands";
import { rightPilesWidth } from "~/lib/right-piles-width";
import { isCombatLineHot } from "~/lib/board-chrome-v4";
import {
    fanLayout,
    CARD_WIDTH,
    CARD_HEIGHT,
    type Placement,
} from "~/lib/board-layout";
import { ArrowAnchorProvider } from "~/hooks/useArrowAnchors";
import { ArrowHighlightProvider } from "~/hooks/ArrowHighlightProvider";
import type { ManualArrowPair } from "~/lib/target-arrow-geometry";
import BoardBattlefield, {
    type BattlefieldRowClassifier,
} from "./board-battlefield";
import BoardPlayer from "./board-player";
import BoardHand from "./board-hand";
import BoardHandPortrait from "./board-hand-portrait";
import BoardPiles from "./board-piles";
import BoardPortraitChips from "./board-portrait-chips";
import BoardArrows from "./board-arrows";
import BoardMidLine from "./board-mid-line";
import GameStack from "./game-stack";
import PriorityIndicator from "./priority-indicator";

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

type BoardSurfaceProps = {
    /** Opponent seat, if present (undefined only while `state` is still being
     *  derived by the mounting caller). */
    opponent: Player | undefined;
    /** Viewer's own seat. */
    me: Player | undefined;
    /** Opponent first, viewer second — same ordering `BoardPiles` /
     *  `BoardPortraitChips` expect. */
    orderedPlayers: Player[];
    /** The seat currently steering the client (solo follows priority, ADR
     *  0001 pins vs-AI/2p to the human's own seat) — drives which hand is
     *  `interactive`. */
    viewerId: string;
    /** The player whose turn it is — `BoardArrows`' attack-target fallback
     *  anchors on whichever seat is NOT this one (CR 508.1a). */
    activePlayerId: string;
    stackItems: StackItem[];
    combat?: Combat;
    /** Manual Mode's player-declared arrows (issue #2171), forwarded verbatim
     *  to `BoardArrows`. Omitted ⇒ no manual arrows (every GRE board). */
    extraArrows?: ManualArrowPair[];
    /** Portrait / landscape-compact / desktop viewport branching — computed
     *  once by the mounting caller so every consumer agrees (`useIsPortrait`
     *  is the portrait projection of the same hook `useViewportMode` reads,
     *  so the two can never disagree). */
    isPortrait: boolean;
    landscapeCompact: boolean;
    viewportHeight: number;
    landscapeCards: LandscapeCardMetrics;
    landscapeHandLayout: (
        count: number,
        width: number,
        height: number
    ) => Placement[];
    /** Mount the priority pod indicator. Defaults to `true` (every GRE board).
     *  A Manual Game has no priority at all (ADR 0080 — no turn structure is
     *  enforced), so it opts out; the indicator would otherwise render a cue
     *  synthesised from an inert context (issue #2169). */
    showPriorityIndicator?: boolean;
    /** Whether the VIEWER's own hand is the interactive, drag-to-cast hand.
     *  Defaults to `true` (every GRE board). A Manual Game opts out: the
     *  interactive hand card dispatches `playCard` / `announceCast` /
     *  `activateAbility` straight at the GRE, and there is no `gameStates` row
     *  behind a manual game for those to land in. Its hand cards are moved by
     *  drag instead (issue #2169). */
    handInteractive?: boolean;
    /** Which battlefield row a permanent lands in, forwarded verbatim to both
     *  seats' {@link BoardBattlefield} (#2166). Omitted ⇒ that component's own
     *  definition-backed default, byte-for-byte today's split. */
    rowClassifier?: BattlefieldRowClassifier;
};

/**
 * Presentational spatial board surface (PRD #249, issue #2165): the four
 * zone bands (opponent hand / opponent battlefield / viewer battlefield /
 * viewer hand), both seats' nameplates, the pile columns (or their portrait
 * chips), the priority pod, the stack panel and the SVG arrow layer. The
 * single source of truth for card positions is the shared pure layout math
 * (`src/lib/board-layout.ts`) — every card in every zone is placed from
 * `rowLayout` / `fanLayout` output rather than static CSS. Both seats use the
 * same math; the opponent's side is mirrored vertically. A single
 * `LayoutGroup` spans every zone so a card's shared-layout element (keyed by
 * instance id in `SpatialSlot`) is matched across zone boundaries — moving
 * hand → battlefield animates the SAME element via a FLIP rather than
 * unmount/remount (#252).
 *
 * Holds no Convex query and no Convex mutation — every value it reads comes
 * in as a prop. It IS still context-coupled: `BoardPlayer`, `BoardBattlefield`,
 * `PriorityIndicator` and `GameStack` read `useGameContext()` and sibling
 * providers for `phase` / `pendingTarget` / `emblems` / `monarchId` /
 * `pendingChoiceBuffer`, so the mounting caller must render this component
 * inside those providers (see `board.tsx`). `GameStack` itself calls
 * `useMutation(api.game.selectTarget)` — that mutation lives on a MOUNTED
 * CHILD, not on this component's own code.
 *
 * The `Controller` pod and every engine-specific banner/dialog (payment
 * banners, pending-choice prompt, target selection banner, cost pickers,
 * mulligan prompt, auto-pass controller, vs-AI driver, game-over dialog) are
 * NOT part of this surface — they stay siblings in `board.tsx`, which keeps
 * deciding where each one lands in DOM order relative to the others.
 */
export default function BoardSurface({
    opponent,
    me,
    orderedPlayers,
    viewerId,
    activePlayerId,
    stackItems,
    combat,
    extraArrows,
    isPortrait,
    landscapeCompact,
    viewportHeight,
    landscapeCards,
    landscapeHandLayout,
    showPriorityIndicator = true,
    handInteractive = true,
    rowClassifier,
}: BoardSurfaceProps) {
    return (
        <ArrowAnchorProvider>
            <ArrowHighlightProvider>
                <LayoutGroup>
                    <div
                        className="absolute inset-0"
                        data-board-root
                        style={
                            {
                                // Life nameplate + hand center
                                // within the space that excludes
                                // the right pile band, not the
                                // full viewport. See
                                // rightPilesWidth() — the
                                // same value is published to
                                // documentElement for dialogs by
                                // `board.tsx`.
                                "--right-piles-w": rightPilesWidth(
                                    isPortrait,
                                    landscapeCompact,
                                    viewportHeight
                                ),
                                // Portrait vertical budget
                                // (#1760): the four bands below
                                // are derived from the hand
                                // strip's height and the bar's
                                // MEASURED clearance, so no band
                                // can run under the one beneath
                                // it. See portrait-board-bands.
                                ...portraitBandVars(),
                                // Landscape vertical
                                // budget (#1768):
                                // four bands plus a
                                // left seat rail and
                                // a right pile rail,
                                // all derived from
                                // ONE shared card
                                // footprint. Inert
                                // unless a landscape
                                // band class reads
                                // them.
                                ...landscapeBandVars(viewportHeight),
                            } as CSSProperties
                        }
                    >
                        {/* The mid-board line (ADR 0103 §1, #2727) — FIRST
                    child so it paints under every card and
                    every piece of chrome. Absolutely
                    positioned and `pointer-events-none`, so
                    it costs no band any height and steals no
                    tap; see `board-mid-line.tsx`. */}
                        <BoardMidLine
                            isPortrait={isPortrait}
                            landscapeCompact={landscapeCompact}
                            hot={isCombatLineHot(combat)}
                        />

                        {/* Opponent: hand on the top edge,
                    battlefield below it — same layout
                    math, mirrored to the top half. */}
                        {opponent && (
                            <>
                                <BoardPlayer player={opponent} side="top" />
                                <div
                                    // Inert hit-test handles (#2169): a
                                    // pointer-driven zone drag resolves its
                                    // drop target with
                                    // `document.elementFromPoint(...)
                                    // .closest('[data-zone-drop]')`. Pure
                                    // attributes — no listener, no styling, no
                                    // behaviour on the GRE board.
                                    data-zone-drop="hand"
                                    data-zone-owner={opponent.id}
                                    className={
                                        isPortrait
                                            ? PORTRAIT_OPPONENT_HAND_BAND
                                            : landscapeCompact
                                              ? LANDSCAPE_OPPONENT_HAND_BAND
                                              : "absolute left-0 right-[var(--right-piles-w)] top-0 h-[18%]"
                                    }
                                >
                                    {isPortrait ? (
                                        <BoardHandPortrait
                                            player={opponent}
                                            interactive={
                                                handInteractive &&
                                                opponent.id === viewerId
                                            }
                                            boardHeight={viewportHeight}
                                            seat="opponent"
                                            data-testid="zone-opponent-hand"
                                        />
                                    ) : (
                                        <BoardHand
                                            player={opponent}
                                            interactive={
                                                handInteractive &&
                                                opponent.id === viewerId
                                            }
                                            // Landscape: the SAME flat row
                                            // and the SAME card footprint as
                                            // the viewer's hand — the band
                                            // clips it to a sliver, which is
                                            // all a face-down count needs.
                                            layout={
                                                landscapeCompact
                                                    ? landscapeHandLayout
                                                    : opponentHandLayout
                                            }
                                            cardWidth={
                                                landscapeCompact
                                                    ? landscapeCards.cardWidth
                                                    : OPP_HAND_CARD_WIDTH
                                            }
                                            cardHeight={
                                                landscapeCompact
                                                    ? landscapeCards.cardHeight
                                                    : OPP_HAND_CARD_HEIGHT
                                            }
                                            mirror
                                            data-testid="zone-opponent-hand"
                                        />
                                    )}
                                </div>
                                <div
                                    data-zone-drop="battlefield"
                                    data-zone-owner={opponent.id}
                                    className={
                                        isPortrait
                                            ? PORTRAIT_OPPONENT_BATTLEFIELD_BAND
                                            : landscapeCompact
                                              ? LANDSCAPE_OPPONENT_BATTLEFIELD_BAND
                                              : "absolute left-0 right-0 top-[18%] h-[32%]"
                                    }
                                >
                                    <BoardBattlefield
                                        player={opponent}
                                        mirror
                                        compact={
                                            landscapeCompact
                                                ? landscapeCards
                                                : undefined
                                        }
                                        rowClassifier={rowClassifier}
                                        data-testid="zone-opponent-battlefield"
                                    />
                                </div>
                            </>
                        )}

                        {/* Viewer: battlefield on the bottom
                    half, hand on the bottom edge. */}
                        {me && (
                            <>
                                <BoardPlayer player={me} side="bottom" />
                                <div
                                    data-zone-drop="battlefield"
                                    data-zone-owner={me.id}
                                    className={
                                        isPortrait
                                            ? // Bottom-anchored to
                                              // the TOP of the hand
                                              // strip (#1760) — a
                                              // fixed `h-[32%]` ran
                                              // past it and hid the
                                              // lands row under a
                                              // full hand.
                                              PORTRAIT_VIEWER_BATTLEFIELD_BAND
                                            : landscapeCompact
                                              ? LANDSCAPE_VIEWER_BATTLEFIELD_BAND
                                              : "absolute left-0 right-0 top-1/2 h-[32%]"
                                    }
                                >
                                    <BoardBattlefield
                                        player={me}
                                        compact={
                                            landscapeCompact
                                                ? landscapeCards
                                                : undefined
                                        }
                                        rowClassifier={rowClassifier}
                                        data-testid="zone-player-battlefield"
                                    />
                                </div>
                                <div
                                    data-zone-drop="hand"
                                    data-zone-owner={me.id}
                                    className={
                                        isPortrait
                                            ? // Lifted clear of the
                                              // variant-D bottom bar
                                              // (#335/#1759) so the
                                              // hand stays fully
                                              // thumb-reachable — by
                                              // the bar's MEASURED
                                              // height, since its
                                              // command row wraps and
                                              // a fixed inset let the
                                              // grown bar cover the
                                              // hand's bottom edge.
                                              // Its height is now the
                                              // shared band the
                                              // battlefield above
                                              // reserves (#1760).
                                              PORTRAIT_VIEWER_HAND_BAND
                                            : landscapeCompact
                                              ? LANDSCAPE_VIEWER_HAND_BAND
                                              : "absolute left-0 right-[var(--right-piles-w)] bottom-0 h-[18%]"
                                    }
                                >
                                    {isPortrait ? (
                                        <BoardHandPortrait
                                            player={me}
                                            interactive={
                                                handInteractive &&
                                                me.id === viewerId
                                            }
                                            boardHeight={viewportHeight}
                                            data-testid="zone-player-hand"
                                        />
                                    ) : (
                                        <BoardHand
                                            player={me}
                                            interactive={
                                                handInteractive &&
                                                me.id === viewerId
                                            }
                                            // Landscape: flat row, and the
                                            // SAME footprint the battlefield
                                            // lays out with — the whole point
                                            // of #1768 (the desktop fan used
                                            // to render 120×168 hand cards
                                            // next to 35×49 permanents).
                                            layout={
                                                landscapeCompact
                                                    ? landscapeHandLayout
                                                    : handLayout
                                            }
                                            cardWidth={
                                                landscapeCompact
                                                    ? landscapeCards.cardWidth
                                                    : undefined
                                            }
                                            cardHeight={
                                                landscapeCompact
                                                    ? landscapeCards.cardHeight
                                                    : undefined
                                            }
                                            data-testid="zone-player-hand"
                                        />
                                    )}
                                </div>
                            </>
                        )}

                        {/* Card piles (graveyard / library /
                    exile) for both seats.
                    Landscape/desktop reuse the spatial
                    pile columns (#255); portrait
                    collapses them — and the stack —
                    into tappable chips that open the
                    SAME reveal / stack views (#336). */}
                        {isPortrait ? (
                            <BoardPortraitChips
                                orderedPlayers={orderedPlayers}
                                stackItems={stackItems}
                            />
                        ) : (
                            <BoardPiles
                                orderedPlayers={orderedPlayers}
                                compact={landscapeCompact}
                            />
                        )}

                        {/* Spatial chrome. The controller pod
                    (phase + priority cue + actions) is
                    mounted below on the right edge
                    (#331), by `board.tsx` — NOT this
                    surface (#2165). */}
                        {showPriorityIndicator && <PriorityIndicator />}
                        {/* Portrait toggles the stack behind a
                    chip (above); landscape-compact gets its
                    OWN chip-triggered right panel, mounted by
                    `ControllerLandscapeStrip` (issue #2589) —
                    NOT here, so the two never double-mount.
                    Only desktop keeps this always-on
                    center-panel mount. */}
                        {!isPortrait &&
                            !landscapeCompact &&
                            stackItems.length > 0 && (
                                <GameStack stack={stackItems} />
                            )}
                        {/* Our own SVG target arrows (#257):
                    endpoints derive from the shared
                    layout placements via the
                    arrow-anchor registry, so arrows
                    stay glued through the spring/tilt
                    motion. */}
                        <BoardArrows
                            stack={stackItems}
                            combat={combat}
                            extraArrows={extraArrows}
                            defenderId={
                                orderedPlayers.find(
                                    (p) => p.id !== activePlayerId
                                )?.id ?? null
                            }
                            anchorRevision={`${me?.id ?? ""}:${opponent?.id ?? ""}`}
                        />
                    </div>
                </LayoutGroup>
            </ArrowHighlightProvider>
        </ArrowAnchorProvider>
    );
}
