import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type {
    ManualCardInstance,
    ManualZone,
    ProjectedManualGameState,
} from "@convex/manual";
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { usePageVisible } from "~/hooks/usePageVisible";
import CardImage from "../cards/card-image";
import CardBack from "../cards/card-back";

const DRAG_THRESHOLD = 4;

type DragState = {
    instanceId: string;
    startX: number;
    startY: number;
    active: boolean;
    shiftKey: boolean;
};

const ManualGameIdCtx = createContext<Id<"games"> | null>(null);
function useManualGameId(): Id<"games"> {
    const id = useContext(ManualGameIdCtx);
    if (!id) throw new Error("Missing ManualGameIdCtx");
    return id;
}

// --- Counter display helpers ---

function counterDisplays(
    counters: Record<string, number> | undefined
): { type: string; count: number; short: string }[] {
    if (!counters) return [];
    return Object.entries(counters)
        .filter(([, c]) => c > 0)
        .map(([type, count]) => ({
            type,
            count,
            short: type.slice(0, 3).toUpperCase(),
        }));
}

function counterTone(type: string): string {
    if (type === "damage")
        return "border border-red-500/60 bg-red-500/20 text-red-100";
    if (type.startsWith("+"))
        return "border border-green-500/60 bg-green-500/20 text-green-100";
    if (type.startsWith("-"))
        return "border border-red-500/60 bg-red-500/20 text-red-100";
    return "border border-amber-500/60 bg-amber-500/20 text-amber-100";
}

// ============================================================================
// Main Board
// ============================================================================

export default function ManualBoard({
    gameId,
    playerId,
}: {
    gameId: Id<"games">;
    playerId: string;
    // Accepted but unused — kept for API compatibility with the route
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    solo?: boolean;
}) {
    const pageVisible = usePageVisible();
    const state = useQuery(
        api.game.getManualState,
        pageVisible ? { gameId, viewerId: playerId } : "skip"
    );

    if (!state) {
        return (
            <div className="flex h-dvh items-center justify-center text-white/60">
                Loading...
            </div>
        );
    }

    return (
        <ManualGameIdCtx.Provider value={gameId}>
            <ManualBoardInner state={state} playerId={playerId} />
        </ManualGameIdCtx.Provider>
    );
}

function ManualBoardInner({
    state,
    playerId,
}: {
    state: ProjectedManualGameState;
    playerId: string;
}) {
    const gameId = useManualGameId();
    const moveCard = useMutation(api.game.manualMoveCard);
    const setTapped = useMutation(api.game.manualSetTapped);
    const untapAll = useMutation(api.game.manualUntapAll);
    const setLane = useMutation(api.game.manualSetLane);
    const attach = useMutation(api.game.manualAttach);
    const setArrow = useMutation(api.game.manualSetArrow);

    const [drag, setDrag] = useState<DragState | null>(null);
    const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
    const dragRef = useRef<DragState | null>(null);

    // Build a lookup of all visible cards for drag resolution
    const cardMap = useMemo(() => {
        const m = new Map<string, ManualCardInstance>();
        for (const p of state.players) {
            for (const c of p.battlefield) m.set(c.id, c);
            for (const c of p.hand) if (c) m.set(c.id, c);
            for (const c of p.graveyard) m.set(c.id, c);
            for (const c of p.exile) m.set(c.id, c);
        }
        return m;
    }, [state]);

    // Untap-all hotkey
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement) return;
            if (e.key === "u" && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                void untapAll({ gameId, playerId });
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [gameId, playerId, untapAll]);

    const viewer = state.players.find((p) => p.id === playerId) ?? null;
    const opponent = state.players.find((p) => p.id !== playerId) ?? null;

    const handlePointerDown = useCallback(
        (e: React.PointerEvent, instanceId: string) => {
            if (e.button !== 0) return;
            const s: DragState = {
                instanceId,
                startX: e.clientX,
                startY: e.clientY,
                active: false,
                shiftKey: e.shiftKey,
            };
            dragRef.current = s;
            setDrag(s);
            setDragPos({ x: 0, y: 0 });
        },
        []
    );

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        const s = dragRef.current;
        if (!s) return;
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (!s.active) {
            if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            s.active = true;
            (e.target as HTMLElement)
                .closest("[data-board-root]")
                ?.setPointerCapture?.(e.pointerId);
        }
        setDragPos({ x: dx, y: dy });
    }, []);

    const handlePointerUp = useCallback(
        (e: React.PointerEvent) => {
            const s = dragRef.current;
            if (!s) return;
            if (s.active) {
                resolveDrop(e, s, cardMap, {
                    gameId,
                    moveCard,
                    setLane,
                    attach,
                    setArrow,
                });
            }
            dragRef.current = null;
            setDrag(null);
            setDragPos({ x: 0, y: 0 });
        },
        [gameId, cardMap, moveCard, setLane, attach, setArrow]
    );

    const handleCardClick = useCallback(
        (instanceId: string) => {
            if (dragRef.current?.active) return;
            const card = cardMap.get(instanceId);
            if (!card) return;
            void setTapped({ gameId, instanceId, tapped: !card.isTapped });
        },
        [gameId, cardMap, setTapped]
    );

    // Drag ghost
    const dragCard = drag ? cardMap.get(drag.instanceId) : null;

    return (
        <div
            data-board-root
            className="flex flex-col h-dvh bg-[#1a1a2e] text-white overflow-hidden select-none"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => {
                dragRef.current = null;
                setDrag(null);
                setDragPos({ x: 0, y: 0 });
            }}
        >
            {/* Hotkeys legend */}
            <div className="absolute top-2 right-2 z-30">
                <HotkeysLegend />
            </div>

            {opponent && (
                <div className="flex-1 flex flex-col min-h-0">
                    <PlayerBoard
                        player={opponent}
                        isViewer={false}
                        onCardPointerDown={handlePointerDown}
                        onCardClick={handleCardClick}
                    />
                </div>
            )}

            <div className="border-t border-white/10" />

            {viewer && (
                <div className="flex-1 flex flex-col min-h-0">
                    <PlayerBoard
                        player={viewer}
                        isViewer={true}
                        onCardPointerDown={handlePointerDown}
                        onCardClick={handleCardClick}
                    />
                </div>
            )}

            {/* Drag ghost */}
            {drag?.active && dragCard && (
                <div
                    className="fixed pointer-events-none z-50"
                    style={{
                        left: drag.startX + dragPos.x - 50,
                        top: drag.startY + dragPos.y - 70,
                        width: 100,
                        height: 140,
                    }}
                >
                    <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-lg opacity-80">
                        <CardImage
                            card={{ id: dragCard.card.id }}
                            sizes="100px"
                            includeThumb={false}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Drop resolution
// ============================================================================

function resolveDrop(
    e: React.PointerEvent,
    s: DragState,
    cardMap: Map<string, ManualCardInstance>,
    muts: {
        gameId: Id<"games">;
        moveCard: ReturnType<typeof useMutation>;
        setLane: ReturnType<typeof useMutation>;
        attach: ReturnType<typeof useMutation>;
        setArrow: ReturnType<typeof useMutation>;
    }
) {
    const { gameId, moveCard, setLane, attach, setArrow } = muts;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    const card = cardMap.get(s.instanceId);
    if (!card) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el) return;

    const isVertical = Math.abs(dy) > Math.abs(dx) * 1.5;

    // Arrows: Shift+drag from battlefield card to another card
    if (s.shiftKey) {
        const targetCardEl = el.closest("[data-card-id]");
        if (targetCardEl) {
            const targetId = targetCardEl.getAttribute("data-card-id");
            if (targetId && targetId !== s.instanceId) {
                void setArrow({ gameId, instanceId: s.instanceId, targetId });
            }
        }
        return;
    }

    // Lane: vertical drag within battlefield
    if (isVertical && card.zone === "battlefield") {
        const newLane: "main" | "combat" = dy < -40 ? "combat" : "main";
        void setLane({ gameId, instanceId: s.instanceId, lane: newLane });
        return;
    }

    // Attach: drop onto another battlefield card
    const targetCardEl = el.closest("[data-card-id]");
    if (targetCardEl) {
        const targetId = targetCardEl.getAttribute("data-card-id");
        if (targetId && targetId !== s.instanceId) {
            const target = cardMap.get(targetId);
            if (target?.zone === "battlefield") {
                void attach({ gameId, instanceId: s.instanceId, targetId });
                return;
            }
        }
    }

    // Zone move
    const zoneEl = el.closest("[data-manual-zone]");
    if (zoneEl) {
        const zone = zoneEl.getAttribute("data-manual-zone") as ManualZone;
        const targetOwner = zoneEl.getAttribute("data-manual-player");
        // Only allow moving own cards to own zones (or opponent's battlefield)
        const allowed =
            targetOwner === card.ownerId ||
            (zone === "battlefield" && card.ownerId !== targetOwner);
        if (zone && zone !== card.zone && allowed) {
            void moveCard({ gameId, instanceId: s.instanceId, toZone: zone });
        }
    }
}

// ============================================================================
// Player Board
// ============================================================================

function PlayerBoard({
    player,
    isViewer,
    onCardPointerDown,
    onCardClick,
}: {
    player: ProjectedManualGameState["players"][0];
    isViewer: boolean;
    onCardPointerDown: (e: React.PointerEvent, instanceId: string) => void;
    onCardClick: (instanceId: string) => void;
}) {
    return (
        <div className="flex-1 flex min-h-0">
            <LifeBar player={player} isViewer={isViewer} />
            <div className="flex-1 flex flex-col min-h-0 p-1 gap-1">
                {/* Battlefield */}
                <div
                    data-manual-zone="battlefield"
                    data-manual-player={player.id}
                    className="flex-1 flex flex-col gap-0.5 rounded border border-white/[0.06] bg-white/[0.02] overflow-y-auto"
                >
                    <CardRow
                        cards={player.battlefield.filter(
                            (c) => c.lane === "combat" && !c.attachedTo
                        )}
                        onPointerDown={onCardPointerDown}
                        onClick={onCardClick}
                    />
                    <CardRow
                        cards={player.battlefield.filter(
                            (c) => c.lane !== "combat" && !c.attachedTo
                        )}
                        onPointerDown={onCardPointerDown}
                        onClick={onCardClick}
                    />
                </div>
                {/* Hand */}
                <div
                    data-manual-zone="hand"
                    data-manual-player={player.id}
                    className="h-18 flex items-center gap-0.5 rounded border border-white/[0.06] bg-white/[0.02] px-1 overflow-x-auto"
                >
                    {player.hand.map((card) =>
                        card ? (
                            <ManualCard
                                key={card.id}
                                card={card}
                                onPointerDown={(e) =>
                                    onCardPointerDown(e, card.id)
                                }
                                onClick={() => onCardClick(card.id)}
                                small
                            />
                        ) : null
                    )}
                </div>
                {/* Piles */}
                <div className="flex gap-1 rounded border border-white/[0.06] bg-white/[0.02] px-1 py-0.5">
                    <LibraryPile
                        playerId={player.id}
                        count={player.library.count}
                        isViewer={isViewer}
                    />
                    <ZonePile
                        zone="graveyard"
                        playerId={player.id}
                        cards={player.graveyard}
                        label="Graveyard"
                    />
                    <ZonePile
                        zone="exile"
                        playerId={player.id}
                        cards={player.exile}
                        label="Exile"
                    />
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Life Bar
// ============================================================================

function LifeBar({
    player,
    isViewer,
}: {
    player: ProjectedManualGameState["players"][0];
    isViewer: boolean;
}) {
    const gameId = useManualGameId();
    const adjustLife = useMutation(api.game.manualAdjustLife);
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState("");

    const startEdit = useCallback(() => {
        setEditVal(String(player.life));
        setEditing(true);
    }, [player.life]);

    const commitEdit = useCallback(() => {
        setEditing(false);
        const n = parseInt(editVal, 10);
        if (!isNaN(n) && n !== player.life) {
            void adjustLife({
                gameId,
                playerId: player.id,
                delta: n - player.life,
            });
        }
    }, [editVal, player.life, gameId, player.id, adjustLife]);

    const handleKey = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
        },
        [commitEdit]
    );

    const handleWheel = useCallback(
        (e: React.WheelEvent) => {
            e.preventDefault();
            void adjustLife({
                gameId,
                playerId: player.id,
                delta: e.deltaY < 0 ? 1 : -1,
            });
        },
        [gameId, player.id, adjustLife]
    );

    return (
        <div
            className="flex flex-col items-center justify-center gap-0.5 w-16 shrink-0 border-r border-white/[0.06]"
            onWheel={isViewer ? handleWheel : undefined}
        >
            <div className="text-[10px] text-white/40 font-bold truncate max-w-full px-1">
                {player.name}
            </div>
            {isViewer && (
                <button
                    className="text-white/60 hover:text-white text-sm leading-none"
                    onClick={(e) => {
                        e.stopPropagation();
                        void adjustLife({
                            gameId,
                            playerId: player.id,
                            delta: 1,
                        });
                    }}
                >
                    +
                </button>
            )}
            {isViewer && editing ? (
                <input
                    autoFocus
                    className="w-12 text-center bg-white/10 rounded border border-white/20 text-lg font-bold text-white"
                    value={editVal}
                    onChange={(e) => setEditVal(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={handleKey}
                />
            ) : (
                <div
                    className={`text-lg font-bold ${isViewer ? "cursor-pointer hover:text-white/80" : "cursor-default"}`}
                    onClick={isViewer ? startEdit : undefined}
                >
                    {player.life}
                </div>
            )}
            {isViewer && (
                <button
                    className="text-white/60 hover:text-white text-sm leading-none"
                    onClick={(e) => {
                        e.stopPropagation();
                        void adjustLife({
                            gameId,
                            playerId: player.id,
                            delta: -1,
                        });
                    }}
                >
                    -
                </button>
            )}
        </div>
    );
}

// ============================================================================
// Card Row (within a zone)
// ============================================================================

function CardRow({
    cards,
    onPointerDown,
    onClick,
}: {
    cards: ManualCardInstance[];
    onPointerDown: (e: React.PointerEvent, instanceId: string) => void;
    onClick: (instanceId: string) => void;
}) {
    if (cards.length === 0) return null;
    return (
        <div className="flex flex-wrap items-start gap-0.5 px-1 py-0.5">
            {cards.map((card) => (
                <ManualCard
                    key={card.id}
                    card={card}
                    onPointerDown={(e) => onPointerDown(e, card.id)}
                    onClick={() => onClick(card.id)}
                />
            ))}
        </div>
    );
}

// ============================================================================
// Manual Card
// ============================================================================

function ManualCard({
    card,
    onPointerDown,
    onClick,
    small,
}: {
    card: ManualCardInstance;
    onPointerDown?: (e: React.PointerEvent) => void;
    onClick?: () => void;
    small?: boolean;
}) {
    const gameId = useManualGameId();
    const setTapped = useMutation(api.game.manualSetTapped);
    const adjustCounter = useMutation(api.game.manualAdjustCounter);
    const setFaceDown = useMutation(api.game.manualSetFaceDown);
    const setNote = useMutation(api.game.manualSetNote);

    const size = small ? "w-12 h-16" : "w-[68px] h-[95px]";
    const displays = counterDisplays(card.counters);

    return (
        <ContextMenu>
            <ContextMenuTrigger>
                <div
                    data-card-id={card.id}
                    className={`relative ${size} shrink-0 cursor-pointer select-none
                        hover:ring-2 hover:ring-white/30 transition-shadow`}
                    onPointerDown={onPointerDown}
                    onClick={() => {
                        if (card.zone === "battlefield") {
                            onClick?.();
                        }
                    }}
                >
                    <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-md">
                        {card.faceDown ? (
                            <CardBack />
                        ) : (
                            <CardImage
                                card={{ id: card.card.id }}
                                sizes={small ? "48px" : "68px"}
                                includeThumb={false}
                            />
                        )}
                    </div>
                    {/* Tapped indicator */}
                    {card.isTapped && (
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                            <div className="w-full h-full rounded-sm bg-black/40" />
                            <svg
                                className="absolute text-white/60 w-5 h-5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                            >
                                <path d="M1 4v6h6" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                            </svg>
                        </div>
                    )}
                    {/* Attached indicator */}
                    {card.attachedTo && (
                        <div className="absolute top-0 right-0 bg-blue-600/80 text-white text-[8px] px-1 rounded-bl z-10">
                            ATT
                        </div>
                    )}
                    {/* Note */}
                    {card.note && (
                        <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white/90 text-[8px] text-center leading-tight px-0.5 py-0.5 truncate z-10">
                            {card.note}
                        </div>
                    )}
                    {/* Counter badges */}
                    {displays.length > 0 && (
                        <div className="absolute top-0.5 left-0.5 z-10 flex flex-col gap-0.5 pointer-events-none">
                            {displays.map((d) => (
                                <div
                                    key={d.type}
                                    className={`rounded-full px-1.5 py-0.5 text-[8px] font-bold leading-none drop-shadow-md ${counterTone(d.type)}`}
                                >
                                    {d.short}
                                    {d.count > 1 ? `×${d.count}` : ""}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
                {/* Tap/untap */}
                <ContextMenuItem
                    inset
                    onClick={() =>
                        void setTapped({
                            gameId,
                            instanceId: card.id,
                            tapped: !card.isTapped,
                        })
                    }
                >
                    {card.isTapped ? "Untap" : "Tap"}
                </ContextMenuItem>
                {/* Face down */}
                <ContextMenuItem
                    inset
                    onClick={() =>
                        void setFaceDown({
                            gameId,
                            instanceId: card.id,
                            faceDown: !card.faceDown,
                        })
                    }
                >
                    {card.faceDown ? "Turn Face Up" : "Turn Face Down"}
                </ContextMenuItem>
                <ContextMenuSeparator />
                {/* Standard counters */}
                <ContextMenuItem
                    inset
                    onClick={() =>
                        void adjustCounter({
                            gameId,
                            instanceId: card.id,
                            type: "+1/+1",
                            delta: 1,
                        })
                    }
                >
                    Add +1/+1 counter
                </ContextMenuItem>
                <ContextMenuItem
                    inset
                    onClick={() =>
                        void adjustCounter({
                            gameId,
                            instanceId: card.id,
                            type: "-1/-1",
                            delta: 1,
                        })
                    }
                >
                    Add -1/-1 counter
                </ContextMenuItem>
                <ContextMenuItem
                    inset
                    onClick={() =>
                        void adjustCounter({
                            gameId,
                            instanceId: card.id,
                            type: "damage",
                            delta: 1,
                        })
                    }
                >
                    Add damage counter
                </ContextMenuItem>
                {card.counters?.damage && card.counters.damage > 0 && (
                    <ContextMenuItem
                        inset
                        onClick={() =>
                            void adjustCounter({
                                gameId,
                                instanceId: card.id,
                                type: "damage",
                                delta: -card.counters!.damage!,
                            })
                        }
                    >
                        Clear damage
                    </ContextMenuItem>
                )}
                <ContextMenuSeparator />
                {/* Custom counter */}
                <ContextMenuItem
                    inset
                    onClick={() => {
                        const name = prompt("Counter type:");
                        if (name?.trim()) {
                            void adjustCounter({
                                gameId,
                                instanceId: card.id,
                                type: name.trim(),
                                delta: 1,
                            });
                        }
                    }}
                >
                    Custom counter...
                </ContextMenuItem>
                <ContextMenuSeparator />
                {/* Note */}
                <ContextMenuItem
                    inset
                    onClick={() => {
                        const note = prompt("Note:", card.note ?? "");
                        if (note !== null) {
                            void setNote({
                                gameId,
                                instanceId: card.id,
                                text: note,
                            });
                        }
                    }}
                >
                    Set note...
                </ContextMenuItem>
            </ContextMenuContent>
        </ContextMenu>
    );
}

// ============================================================================
// Zone Pile (graveyard, exile)
// ============================================================================

function ZonePile({
    zone,
    playerId,
    cards,
    label,
}: {
    zone: ManualZone;
    playerId: string;
    cards: ManualCardInstance[];
    label: string;
}) {
    return (
        <div
            data-manual-zone={zone}
            data-manual-player={playerId}
            className="flex-1 min-w-0 flex flex-col items-center"
        >
            <div className="text-[9px] text-white/40 mb-0.5">{label}</div>
            <div className="relative w-10 h-14">
                {cards.length > 0 ? (
                    <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-lg">
                        <CardImage
                            card={{ id: cards[cards.length - 1].card.id }}
                            sizes="40px"
                            includeThumb={false}
                        />
                    </div>
                ) : (
                    <div className="w-full h-full rounded-sm border border-dashed border-white/10 flex items-center justify-center text-white/20 text-[8px]">
                        empty
                    </div>
                )}
                {cards.length > 1 && (
                    <div className="absolute -top-0.5 -right-0.5 bg-white/20 text-white text-[8px] rounded-full px-1 leading-none">
                        {cards.length}
                    </div>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// Library Pile
// ============================================================================

function LibraryPile({
    playerId,
    count,
    isViewer,
}: {
    playerId: string;
    count: number;
    isViewer: boolean;
}) {
    const gameId = useManualGameId();
    const draw = useMutation(api.game.manualDraw);
    const mill = useMutation(api.game.manualMill);
    const exileTop = useMutation(api.game.manualExileTop);
    const peek = useMutation(api.game.manualPeek);
    const shuffle = useMutation(api.game.manualShuffle);

    return (
        <ContextMenu>
            <ContextMenuTrigger>
                <div
                    data-manual-zone="library"
                    data-manual-player={playerId}
                    className="flex-1 min-w-0 flex flex-col items-center cursor-pointer"
                >
                    <div className="text-[9px] text-white/40 mb-0.5">
                        {count} cards
                    </div>
                    <div className="relative w-10 h-14">
                        {count > 0 ? (
                            <div className="w-full h-full rounded-sm overflow-hidden ring-1 ring-black/40 shadow-lg">
                                <CardBack />
                            </div>
                        ) : (
                            <div className="w-full h-full rounded-sm border border-dashed border-white/10 flex items-center justify-center text-white/20 text-[8px]">
                                empty
                            </div>
                        )}
                    </div>
                </div>
            </ContextMenuTrigger>
            {isViewer && (
                <ContextMenuContent className="w-44">
                    <ContextMenuItem
                        inset
                        onClick={() => void draw({ gameId, playerId, n: 1 })}
                    >
                        Draw 1
                    </ContextMenuItem>
                    <ContextMenuItem
                        inset
                        onClick={() => {
                            const n = parseInt(
                                prompt("Draw how many?", "1") ?? "0",
                                10
                            );
                            if (n > 0) void draw({ gameId, playerId, n });
                        }}
                    >
                        Draw N...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        inset
                        onClick={() => void mill({ gameId, playerId, n: 1 })}
                    >
                        Mill 1
                    </ContextMenuItem>
                    <ContextMenuItem
                        inset
                        onClick={() => {
                            const n = parseInt(
                                prompt("Mill how many?", "1") ?? "0",
                                10
                            );
                            if (n > 0) void mill({ gameId, playerId, n });
                        }}
                    >
                        Mill N...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        inset
                        onClick={() =>
                            void exileTop({ gameId, playerId, n: 1 })
                        }
                    >
                        Exile top 1
                    </ContextMenuItem>
                    <ContextMenuItem
                        inset
                        onClick={() => {
                            const n = parseInt(
                                prompt("Exile how many?", "1") ?? "0",
                                10
                            );
                            if (n > 0) void exileTop({ gameId, playerId, n });
                        }}
                    >
                        Exile top N...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        inset
                        onClick={() => {
                            const n = parseInt(
                                prompt("Peek how many?", "3") ?? "0",
                                10
                            );
                            if (n > 0) void peek({ gameId, playerId, n });
                        }}
                    >
                        Peek top N...
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                        inset
                        onClick={() => {
                            if (
                                confirm(
                                    "Shuffle library? This cannot be undone."
                                )
                            ) {
                                void shuffle({ gameId, playerId });
                            }
                        }}
                    >
                        Shuffle
                    </ContextMenuItem>
                </ContextMenuContent>
            )}
        </ContextMenu>
    );
}

// ============================================================================
// Hotkeys Legend
// ============================================================================

function HotkeysLegend() {
    return (
        <div className="relative group">
            <button className="bg-black/60 hover:bg-black/80 text-white/80 p-2 rounded-lg text-sm transition-colors shadow-lg">
                <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                >
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M6 16h.01M10 16h.01M14 16h.01M18 16h.01" />
                </svg>
            </button>
            <div className="absolute right-0 top-full mt-1 bg-black/85 backdrop-blur-sm border border-white/[0.08] rounded-lg p-3 shadow-xl w-60 hidden group-hover:block">
                <div className="font-semibold mb-2 text-white/90 text-sm">
                    Hotkeys
                </div>
                <div className="flex flex-col gap-1.5">
                    <HK keys={["U"]} label="Untap all" />
                    <HK keys={["Shift", "drag"]} label="Set arrow" />
                    <HK keys={["click"]} label="Tap / untap card" />
                    <HK keys={["drag"]} label="Move card between zones" />
                    <HK
                        keys={["vertical drag"]}
                        label="Set lane (combat/main)"
                    />
                    <HK
                        keys={["right-click"]}
                        label="Context menu (counters, note)"
                    />
                    <HK keys={["wheel / + −"]} label="Adjust life total" />
                </div>
            </div>
        </div>
    );
}

function HK({ keys, label }: { keys: string[]; label: string }) {
    return (
        <div className="flex items-center gap-2">
            <div className="flex gap-1">
                {keys.map((k, i) => (
                    <span key={i} className="inline-flex">
                        {i > 0 && <span className="text-white/40 mr-1">+</span>}
                        <kbd className="inline-flex items-center px-1.5 py-0.5 rounded bg-white/10 border border-white/20 text-[10px] font-mono text-white/90">
                            {k}
                        </kbd>
                    </span>
                ))}
            </div>
            <span className="text-white/70 text-xs">{label}</span>
        </div>
    );
}
