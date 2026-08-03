import {
    useMemo,
    useRef,
    useState,
    useEffect,
    type CSSProperties,
} from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
    MANUAL_FACE_DOWN_CARD_ID,
    type ProjectedManualCard,
    type ProjectedManualPlayer,
} from "@convex/manual";
import { useIsPortrait } from "~/hooks/useIsPortrait";
import { useViewportMode } from "~/hooks/useViewportMode";
import { useViewportHeight } from "~/hooks/useViewportHeight";
import { usePageVisible } from "~/hooks/usePageVisible";
import {
    LANDSCAPE_OPPONENT_HAND_BAND,
    LANDSCAPE_OPPONENT_BATTLEFIELD_BAND,
    LANDSCAPE_VIEWER_BATTLEFIELD_BAND,
    LANDSCAPE_VIEWER_HAND_BAND,
    LANDSCAPE_OPPONENT_SEAT_ANCHOR,
    LANDSCAPE_VIEWER_SEAT_ANCHOR,
    LANDSCAPE_OPPONENT_PILES_ANCHOR,
    LANDSCAPE_VIEWER_PILES_ANCHOR,
    landscapeBandVars,
    landscapeCardMetrics,
    landscapePileVars,
    makeLandscapeHandLayout,
    LANDSCAPE_PILE_SCALE,
} from "~/lib/landscape-board-bands";
import { CONTROLLER_STRIP_CLEARANCE_EXPR } from "~/lib/controller-bar-metrics";
import {
    rowLayout,
    fanLayout,
    CARD_WIDTH,
    CARD_HEIGHT,
    type Placement,
} from "~/lib/board-layout";
import CardImage from "../cards/card-image";
import CardBack from "../cards/card-back";
import BoardBackground from "./board-background";

/** Right pile band width (mirrors `rightPilesWidth` in board.tsx). */
function rightPilesWidth(
    isPortrait: boolean,
    landscapeCompact: boolean,
    viewportHeight: number
): string {
    if (isPortrait) return "0px";
    if (landscapeCompact) {
        const pileWidth =
            landscapeCardMetrics(viewportHeight).cardWidth *
            LANDSCAPE_PILE_SCALE;
        return `calc(${CONTROLLER_STRIP_CLEARANCE_EXPR} + ${pileWidth}px + 0.5rem)`;
    }
    return "calc(1.75rem + 3 * var(--card-w-sm))";
}

/** Hand: shallow fanned arc for desktop, flat row for landscape-compact. */
function handLayout(
    count: number,
    width: number,
    height: number,
    landscapeCompact: boolean,
    landscapeCardW: number
): Placement[] {
    if (landscapeCompact) {
        return makeLandscapeHandLayout(landscapeCardW)(count, width, height);
    }
    return fanLayout({ count, width, baseY: height * 0.6 });
}

const OPP_HAND_CARD_WIDTH = Math.round(CARD_WIDTH * 0.7);
const OPP_HAND_CARD_HEIGHT = Math.round(CARD_HEIGHT * 0.7);

function opponentHandLayout(
    count: number,
    width: number,
    height: number,
    landscapeCompact: boolean,
    landscapeCardW: number
): Placement[] {
    if (landscapeCompact) {
        return makeLandscapeHandLayout(landscapeCardW)(count, width, height);
    }
    return fanLayout({
        count,
        width,
        baseY: height * 0.72,
        cardWidth: OPP_HAND_CARD_WIDTH,
        cardHeight: OPP_HAND_CARD_HEIGHT,
    });
}

type ManualBoardProps = {
    gameId: Id<"games">;
    playerId: string;
    solo: boolean;
};

/** Simple player chrome: name + life, no interaction hooks. */
function ManualPlayerChrome({
    player,
    side,
}: {
    player: ProjectedManualPlayer;
    side: "top" | "bottom";
}) {
    const landscapeCompact = useViewportMode() === "landscape-compact";
    const className = landscapeCompact
        ? side === "top"
            ? LANDSCAPE_OPPONENT_SEAT_ANCHOR
            : LANDSCAPE_VIEWER_SEAT_ANCHOR
        : side === "top"
          ? "play-area-center-x -translate-x-1/2 top-1"
          : "play-area-center-x -translate-x-1/2 bottom-1";

    return (
        <div className={`absolute z-10 ${className}`}>
            <div
                className="flex items-center gap-2 px-2 py-1 rounded text-white text-sm font-medium"
                style={{ background: player.bgColor }}
            >
                <span className="truncate max-w-[140px]">{player.name}</span>
                <span className="tabular-nums font-bold">{player.life}</span>
            </div>
        </div>
    );
}

/** A single card placed at a given position. Uses CardImage for the printed
 *  card art — no CardDefinition needed (tryGetDefinition falls through safely). */
function ManualBoardCard({
    card,
    placement,
    mirror,
    size,
}: {
    card: ProjectedManualCard | null;
    placement: Placement;
    mirror?: boolean;
    size?: { width: number; height: number };
}) {
    const w = size?.width ?? CARD_WIDTH;
    const h = size?.height ?? CARD_HEIGHT;
    const cardRef = card ? { id: card.card.id } : null;
    const isFaceDown = card?.card.id === MANUAL_FACE_DOWN_CARD_ID;

    return (
        <div
            className="absolute"
            style={{
                left: placement.x - (w * placement.scale) / 2,
                top: placement.y - (h * placement.scale) / 2,
                width: w * placement.scale,
                height: h * placement.scale,
                transform: `rotate(${mirror ? -placement.rotation : placement.rotation}deg)`,
                zIndex: 1,
            }}
        >
            <div className="w-full h-full rounded-[7%] overflow-hidden ring-1 ring-black/40 shadow-[0_4px_12px_rgba(0,0,0,0.5)]">
                {cardRef && !isFaceDown ? (
                    <CardImage
                        card={cardRef}
                        sizes="120px"
                        includeThumb={false}
                    />
                ) : cardRef && isFaceDown ? (
                    <CardBack />
                ) : (
                    <div className="w-full h-full bg-[#1a3a5c] rounded-[7%]" />
                )}
            </div>
        </div>
    );
}

/** Pile tile for a zone (library/graveyard/exile/sideboard). Stacked look with count. */
function ManualPileTile({
    label,
    count,
    size,
}: {
    label: string;
    count: number;
    size?: { width: number; height: number };
}) {
    const w = size?.width ?? 72;
    const h = size?.height ?? Math.round(w * 1.4);

    return (
        <div
            className="relative flex-shrink-0 rounded-sm overflow-hidden ring-1 ring-white/20"
            style={{ width: w, height: h }}
        >
            <div className="w-full h-full bg-[#1a3a5c] flex items-center justify-center" />
            <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-white text-[10px] text-center leading-tight px-0.5">
                {label} ({count})
            </div>
        </div>
    );
}

/** Zone-sized container that publishes its measured dimensions to a callback,
 *  so card placement math uses the actual rendered size. */
function ZoneMeasurer({
    children,
    onMeasure,
    className,
    style,
}: {
    children: React.ReactNode;
    onMeasure: (w: number, h: number) => void;
    className?: string;
    style?: CSSProperties;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver((entries) => {
            const { width, height } = entries[0].contentRect;
            onMeasure(width, height);
        });
        ro.observe(el);
        onMeasure(el.clientWidth, el.clientHeight);
        return () => ro.disconnect();
    }, [onMeasure]);

    return (
        <div
            ref={ref}
            className={className ? `relative ${className}` : "relative"}
            style={style}
        >
            {children}
        </div>
    );
}

/** Hand zone: fanned cards for the viewer, backs for the opponent. */
function ManualHandZone({
    cards,
    landscapeCompact,
    landscapeCardW,
    mirror,
    size,
    className,
}: {
    cards: (ProjectedManualCard | null)[];
    landscapeCompact: boolean;
    landscapeCardW: number;
    mirror?: boolean;
    size?: { width: number; height: number };
    className?: string;
}) {
    const [dims, setDims] = useState({ width: 0, height: 0 });
    const visible = cards.filter((c) => c !== null) as ProjectedManualCard[];
    // For the opponent's hand every card is null (projection hides identity),
    // but the count is still the array length — render that many backs.
    const count = cards.length;

    const placements = useMemo(() => {
        if (count === 0) return [];
        const layout = mirror ? opponentHandLayout : handLayout;
        return layout(
            count,
            dims.width || 400,
            dims.height || 60,
            landscapeCompact,
            landscapeCardW
        );
    }, [count, dims, mirror, landscapeCompact, landscapeCardW]);

    return (
        <ZoneMeasurer
            onMeasure={(w, h) => setDims({ width: w, height: h })}
            className={className}
        >
            {placements.map((p, i) => (
                <ManualBoardCard
                    key={visible[i]?.id ?? `back-${i}`}
                    card={visible[i] ?? null}
                    placement={p}
                    mirror={mirror}
                    size={size}
                />
            ))}
        </ZoneMeasurer>
    );
}

/** Battlefield zone: two rows — combat lane (front, toward midline) and main lane (back). */
function ManualBattlefieldZone({
    player,
    mirror,
    compact,
    className,
}: {
    player: ProjectedManualPlayer;
    mirror?: boolean;
    compact?: { cardWidth: number; cardHeight: number; bandPad: number };
    className?: string;
}) {
    const [dims, setDims] = useState({ width: 0, height: 0 });
    const cardW = compact?.cardWidth ?? CARD_WIDTH;
    const cardH = compact?.cardHeight ?? CARD_HEIGHT;

    const combatCards = player.battlefield.filter((c) => c.lane === "combat");
    const mainCards = player.battlefield.filter((c) => c.lane !== "combat");

    const combatCount = combatCards.length;
    const mainCount = mainCards.length;
    const total = combatCount + mainCount;
    const height = dims.height || 100;
    const width = dims.width || 400;

    const combatRowCenterY = mirror ? height * 0.72 : height * 0.28;
    const mainRowCenterY = mirror ? height * 0.28 : height * 0.72;

    const combatPlacements = useMemo(
        () =>
            combatCount > 0
                ? rowLayout({
                      count: combatCount,
                      width,
                      centerY: combatRowCenterY,
                      cardWidth: cardW,
                  })
                : [],
        [combatCount, width, combatRowCenterY, cardW]
    );

    const mainPlacements = useMemo(
        () =>
            mainCount > 0
                ? rowLayout({
                      count: mainCount,
                      width,
                      centerY: mainRowCenterY,
                      cardWidth: cardW,
                  })
                : [],
        [mainCount, width, mainRowCenterY, cardW]
    );

    const size = { width: cardW, height: cardH };

    return (
        <ZoneMeasurer
            onMeasure={(w, h) => setDims({ width: w, height: h })}
            className={className}
        >
            {total === 0 ? null : (
                <>
                    {combatPlacements.map((p, i) => (
                        <ManualBoardCard
                            key={combatCards[i].id}
                            card={combatCards[i]}
                            placement={p}
                            mirror={mirror}
                            size={size}
                        />
                    ))}
                    {mainPlacements.map((p, i) => (
                        <ManualBoardCard
                            key={mainCards[i].id}
                            card={mainCards[i]}
                            placement={p}
                            mirror={mirror}
                            size={size}
                        />
                    ))}
                </>
            )}
        </ZoneMeasurer>
    );
}

/** Pile column for one player: library, graveyard, exile, sideboard tiles. */
function ManualPilesBar({
    player,
    compact,
    className,
}: {
    player: ProjectedManualPlayer;
    compact?: boolean;
    className?: string;
}) {
    const railStyle = compact ? landscapePileVars() : undefined;
    const [viewportH, setViewportH] = useState(
        typeof window !== "undefined" ? window.innerHeight : 800
    );

    useEffect(() => {
        const cb = () => setViewportH(window.innerHeight);
        window.addEventListener("resize", cb);
        return () => window.removeEventListener("resize", cb);
    }, []);

    const compactCards = compact ? landscapeCardMetrics(viewportH) : undefined;
    const tileW = compactCards
        ? compactCards.cardWidth * LANDSCAPE_PILE_SCALE
        : 72;
    const tileH = Math.round(tileW * 1.4);

    const libraryCount = player.library.count;

    const piles = [
        { label: "SB", count: 0 },
        { label: "Exile", count: player.exile.length },
        { label: "GY", count: player.graveyard.length },
        { label: "Lib", count: libraryCount },
    ];

    return (
        <div className={className} style={railStyle}>
            {piles.map((pile) => (
                <ManualPileTile
                    key={pile.label}
                    label={pile.label}
                    count={pile.count}
                    size={{ width: tileW, height: tileH }}
                />
            ))}
        </div>
    );
}

export default function ManualBoard({ gameId, playerId }: ManualBoardProps) {
    const pageVisible = usePageVisible();
    const isPortrait = useIsPortrait();
    const landscapeCompact = useViewportMode() === "landscape-compact";
    const viewportHeight = useViewportHeight();

    const game = useQuery(api.game.getGame, pageVisible ? { gameId } : "skip");

    const state = useQuery(
        api.game.getManualState,
        pageVisible && game ? { gameId, viewerId: playerId } : "skip"
    );

    const landscapeCards = useMemo(
        () => landscapeCardMetrics(viewportHeight),
        [viewportHeight]
    );

    if (!state || !game) {
        return (
            <div className="flex h-full items-center justify-center text-white">
                Loading...
            </div>
        );
    }

    const players = state.players;
    const opponent = players.find((p) => p.id !== playerId);
    const me = players.find((p) => p.id === playerId);

    return (
        <main className="flex h-full w-full flex-col relative overflow-hidden">
            <BoardBackground />
            <div
                className="absolute inset-0"
                data-board-root
                style={
                    {
                        "--right-piles-w": rightPilesWidth(
                            isPortrait,
                            landscapeCompact,
                            viewportHeight
                        ),
                        ...landscapeBandVars(viewportHeight),
                    } as CSSProperties
                }
            >
                {/* Opponent */}
                {opponent && (
                    <>
                        <ManualPlayerChrome player={opponent} side="top" />
                        <ManualHandZone
                            cards={opponent.hand}
                            landscapeCompact={landscapeCompact}
                            landscapeCardW={landscapeCards.cardWidth}
                            mirror
                            size={
                                landscapeCompact
                                    ? {
                                          width: landscapeCards.cardWidth,
                                          height: landscapeCards.cardHeight,
                                      }
                                    : undefined
                            }
                            className={
                                landscapeCompact
                                    ? LANDSCAPE_OPPONENT_HAND_BAND
                                    : "absolute left-0 right-[var(--right-piles-w)] top-0 h-[18%]"
                            }
                        />
                        <ManualBattlefieldZone
                            player={opponent}
                            mirror
                            compact={
                                landscapeCompact ? landscapeCards : undefined
                            }
                            className={
                                landscapeCompact
                                    ? LANDSCAPE_OPPONENT_BATTLEFIELD_BAND
                                    : "absolute left-0 right-0 top-[18%] h-[32%]"
                            }
                        />
                        <ManualPilesBar
                            player={opponent}
                            compact={landscapeCompact}
                            className={
                                landscapeCompact
                                    ? LANDSCAPE_OPPONENT_PILES_ANCHOR
                                    : "absolute right-3 top-3 z-30"
                            }
                        />
                    </>
                )}

                {/* Viewer */}
                {me && (
                    <>
                        <ManualPlayerChrome player={me} side="bottom" />
                        <ManualBattlefieldZone
                            player={me}
                            compact={
                                landscapeCompact ? landscapeCards : undefined
                            }
                            className={
                                landscapeCompact
                                    ? LANDSCAPE_VIEWER_BATTLEFIELD_BAND
                                    : "absolute left-0 right-0 top-1/2 h-[32%]"
                            }
                        />
                        <ManualHandZone
                            cards={me.hand}
                            landscapeCompact={landscapeCompact}
                            landscapeCardW={landscapeCards.cardWidth}
                            size={
                                landscapeCompact
                                    ? {
                                          width: landscapeCards.cardWidth,
                                          height: landscapeCards.cardHeight,
                                      }
                                    : undefined
                            }
                            className={
                                landscapeCompact
                                    ? LANDSCAPE_VIEWER_HAND_BAND
                                    : "absolute left-0 right-[var(--right-piles-w)] bottom-0 h-[18%]"
                            }
                        />
                        <ManualPilesBar
                            player={me}
                            compact={landscapeCompact}
                            className={
                                landscapeCompact
                                    ? LANDSCAPE_VIEWER_PILES_ANCHOR
                                    : "absolute right-3 bottom-3 z-30"
                            }
                        />
                    </>
                )}
            </div>
        </main>
    );
}
