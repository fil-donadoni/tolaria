import { useMemo, useState, type ReactNode } from "react";
import type { PublicMatch } from "@convex/matches";
import useSessionPreviewView from "~/hooks/useSessionPreviewView";
import useSideboardDrag from "~/hooks/useSideboardDrag";
import { useViewportWidth } from "~/hooks/useViewportWidth";
import { setMaindeckCount, type SideboardSplit } from "~/lib/deckSideboard";
import {
    buildSideboardPool,
    groupSideboardRows,
    moveCopies,
    sideboardChangeTotals,
    type SideboardPoolRow,
    type SideboardTileHandlers,
    type SideboardZone,
} from "~/lib/sideboard-pool";
import { cn } from "~/lib/utils";
import SideboardCardPreview from "./sideboard-card-preview";
import SideboardCascade from "./sideboard-cascade";
import SideboardChanges from "./sideboard-changes";
import SideboardDragGhost from "./sideboard-drag-ghost";
import SideboardFocusActions from "./sideboard-focus-actions";
import SideboardInspect from "./sideboard-inspect";
import SideboardReadyDock from "./sideboard-ready-dock";
import SideboardZonePane from "./sideboard-zone-pane";

/** From this viewport width (Tailwind `xl`) the Sideboard cascades in two
 *  columns. */
const WIDE_SIDEBOARD_PX = 1280;

/**
 * The Sideboarding window's body (issue #9820): the deck as the player
 * pictures it. Maindeck printed cards cascade in type columns, the Sideboard
 * beside it, the board's preview + explicit moves in an inspector (≥ lg), the
 * Changes row above and the Ready dock below.
 *
 * Gestures: click / tap = one copy to the other zone, Shift+click = every
 * copy; drag (mouse, or a sideways swipe on touch) onto the other zone, its
 * "All N" pad or with Shift for every copy; long-press on touch opens the
 * Inspect Overlay. A card sits in a zone only while it has copies there.
 */
export default function SideboardEditor({
    start,
    split,
    onSplitChange,
    lockedSize,
    gameNumber,
    isChooser,
    playDraw,
    onPlayDraw,
    opponent,
    countdown,
    locked,
    onReady,
}: {
    /** The split when the window opened — the Changes row's baseline. */
    start: SideboardSplit;
    split: SideboardSplit;
    onSplitChange: (f: (s: SideboardSplit) => SideboardSplit) => void;
    lockedSize: number;
    /** The game about to start. */
    gameNumber: number;
    isChooser: boolean;
    playDraw: "play" | "draw";
    onPlayDraw: (value: "play" | "draw") => void;
    opponent: PublicMatch["players"][number] | null;
    countdown: ReactNode;
    /** Ready is in flight or done: every move is off. */
    locked: boolean;
    onReady: () => void;
}) {
    const pool = useMemo(
        () => buildSideboardPool(start, split),
        [start, split]
    );
    const [focusId, setFocusId] = useState<string | undefined>(undefined);
    const [inspectId, setInspectId] = useState<string | null>(null);
    const [view, setView] = useSessionPreviewView();
    const wideSide = useViewportWidth() >= WIDE_SIDEBOARD_PX;

    const move = (cardId: string, to: SideboardZone, all: boolean) => {
        if (locked) return;
        setFocusId(cardId);
        onSplitChange((s) => moveCopies(s, cardId, to, all));
    };
    const {
        drag,
        start: startDrag,
        suppressClick,
    } = useSideboardDrag(move, setInspectId);
    const undo = (row: SideboardPoolRow) =>
        onSplitChange((s) => setMaindeckCount(s, row.cardId, row.startMain));
    const reset = () =>
        onSplitChange(() => ({
            cards: [...start.cards],
            sideboard: [...start.sideboard],
        }));

    const mainRows = pool.filter((r) => r.main > 0);
    const sideRows = pool.filter((r) => r.side > 0);
    const mainCount = split.cards.length;
    const sideCount = split.sideboard.length;
    const { ins, outs } = sideboardChangeTotals(pool);
    const focus = pool.find((r) => r.cardId === focusId) ?? mainRows[0];
    const dragRow = drag
        ? pool.find((r) => r.cardId === drag.cardId)
        : undefined;
    const inspectRow = inspectId
        ? pool.find((r) => r.cardId === inspectId)
        : undefined;
    const tiles: SideboardTileHandlers = {
        focusId: focus?.cardId,
        onFocus: (id) => {
            if (!drag) setFocusId(id);
        },
        onMove: move,
        onDragStart: startDrag,
        suppressClick,
        draggingId: drag?.cardId,
        disabled: locked,
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle/40 px-4 py-2 sm:px-5">
                <span className="text-[10px] uppercase tracking-wide text-text-muted">
                    Changes
                </span>
                <SideboardChanges
                    pool={pool}
                    onUndo={undo}
                    onReset={reset}
                    disabled={locked}
                />
                <span className="ml-auto text-[11px] text-text-disabled md:hidden">
                    Tap: move 1 · swipe sideways: drag · hold: read
                </span>
                <span className="ml-auto hidden text-[11px] text-text-disabled md:inline">
                    Click or drag: 1 copy · Shift or drop on “All”: every copy
                </span>
            </div>
            <div
                className={cn(
                    "flex min-h-0 flex-1 select-none [--card-w:100%] sm:[--card-w:180px]",
                    drag && "cursor-grabbing"
                )}
            >
                <SideboardZonePane
                    zone="main"
                    rows={mainRows}
                    count={mainCount}
                    drag={drag}
                    dragRow={dragRow}
                    className="min-w-0 flex-1"
                >
                    <div className="flex flex-col gap-5 sm:flex-row sm:flex-wrap">
                        {groupSideboardRows(mainRows).map((g) => (
                            <SideboardCascade
                                key={g.group}
                                title={g.group}
                                count={g.rows.reduce((n, r) => n + r.main, 0)}
                                rows={g.rows}
                                zone="main"
                                {...tiles}
                            />
                        ))}
                    </div>
                </SideboardZonePane>
                <SideboardZonePane
                    zone="side"
                    rows={sideRows}
                    count={sideCount}
                    drag={drag}
                    dragRow={dragRow}
                    className="w-1/2 shrink-0 border-l border-border-subtle/40 bg-surface-base/60 sm:w-[calc(180px+3rem)] xl:w-[calc(360px+4.25rem)]"
                >
                    {sideRows.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border-subtle p-4 text-center text-xs text-text-disabled">
                            Empty — drag cards here
                        </div>
                    ) : (
                        <SideboardCascade
                            count={sideCount}
                            rows={sideRows}
                            zone="side"
                            split={wideSide}
                            {...tiles}
                        />
                    )}
                </SideboardZonePane>
                {focus && (
                    <aside
                        data-testid="sideboard-inspector"
                        className="hidden w-[22rem] shrink-0 flex-col gap-3 overflow-hidden border-l border-border-subtle/40 p-3 lg:flex"
                    >
                        <SideboardCardPreview
                            cardId={focus.cardId}
                            view={view}
                            onViewChange={setView}
                            className="min-h-0 flex-1"
                        />
                        <SideboardFocusActions
                            row={focus}
                            onMove={move}
                            disabled={locked}
                        />
                    </aside>
                )}
            </div>
            <SideboardReadyDock
                mainCount={mainCount}
                lockedSize={lockedSize}
                sideCount={sideCount}
                ins={ins}
                outs={outs}
                gameNumber={gameNumber}
                isChooser={isChooser}
                playDraw={playDraw}
                onPlayDraw={onPlayDraw}
                opponent={opponent}
                countdown={countdown}
                waiting={locked}
                onReady={onReady}
            />
            {drag && dragRow && (
                <SideboardDragGhost drag={drag} row={dragRow} />
            )}
            {inspectRow && (
                <SideboardInspect
                    row={inspectRow}
                    order={[
                        ...mainRows,
                        ...sideRows.filter((r) => r.main === 0),
                    ]}
                    onGo={setInspectId}
                    onClose={() => setInspectId(null)}
                    onMove={move}
                    disabled={locked}
                    view={view}
                    onViewChange={setView}
                />
            )}
        </div>
    );
}
