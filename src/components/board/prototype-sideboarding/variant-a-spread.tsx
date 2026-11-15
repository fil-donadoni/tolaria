// PROTOTYPE — throwaway. Variant A "Spread" (round 2, after verdict "A as the
// base"): the deck as the player pictures it — printed cards cascaded in type
// columns (Maindeck) next to a Sideboard column, a fixed inspector reusing the
// board dock's preview body.
//
// Round-2 changes: drag & drop both ways (pointer-driven, touch = long-press);
// a moved card LEAVES its zone (no ghost); no name overlay — the printed name
// bar shows, plus one count badge; change chips carry an X.
//
// Copy gesture: click / drag = one copy; Shift, or dropping on the "All N" pad
// that appears in the target zone, = every copy. The inspector repeats both.
import { useEffect, useState } from "react";
import {
    ArrowLeft,
    ArrowRight,
    ChevronsLeft,
    ChevronsRight,
} from "lucide-react";
import ProtoSheet from "./proto-sheet";
import ProtoCardImg from "./proto-card-img";
import ProtoPreview from "./proto-preview";
import ProtoReadyBar from "./proto-ready-bar";
import ProtoChanges from "./proto-changes";
import ProtoDragGhost from "./proto-drag-ghost";
import InspectOverlay from "~/components/editing/inspect-overlay";
import { useProtoDrag, type DragInfo, type Zone } from "./use-proto-drag";
import {
    groupBy,
    moveAll,
    moveOne,
    type Dir,
    type PoolRow,
} from "./proto-model";
import type { ProtoVariantProps } from "./proto-types";
import { cn } from "~/lib/utils";

// Card width is a CSS var: phone = the zone's full width (Maindeck and
// Sideboard side by side, half the sheet each, ONE column per zone); sm+ = a
// fixed 180px card in type columns.
const CARD_W = "var(--card-w)";
const PEEK = 36; // px of each cascaded card left visible (its printed name bar)

function useMinWidth(px: number) {
    const q = `(min-width: ${px}px)`;
    const [ok, setOk] = useState(() => window.matchMedia(q).matches);
    useEffect(() => {
        const m = window.matchMedia(q);
        const on = () => setOk(m.matches);
        m.addEventListener("change", on);
        return () => m.removeEventListener("change", on);
    }, [q]);
    return ok;
}

export default function VariantASpread(p: ProtoVariantProps) {
    const [focusId, setFocusId] = useState<string>(p.pool[0]?.cardId ?? "");
    const focus = p.pool.find((r) => r.cardId === focusId) ?? p.pool[0];
    const act = (r: PoolRow, dir: Dir, all: boolean) => {
        setFocusId(r.cardId);
        p.setSplit((s) =>
            all ? moveAll(s, r.cardId, dir) : moveOne(s, r.cardId, dir)
        );
    };
    // Phone: long-press reads the card (the editing surfaces' Inspect
    // Overlay, actions inside); a sideways swipe is the drag.
    const [inspectId, setInspectId] = useState<string | null>(null);
    const { drag, start, suppressClick } = useProtoDrag(
        (cardId, _from, to, all) => {
            const r = p.pool.find((x) => x.cardId === cardId);
            if (r) act(r, to === "side" ? "toSide" : "toMain", all);
        },
        (cardId) => setInspectId(cardId)
    );
    const wideSide = useMinWidth(1280); // xl: the Sideboard splits in two
    const dragRow = drag
        ? p.pool.find((r) => r.cardId === drag.cardId)
        : undefined;
    // A card sits in a zone only while it has copies there: moved = gone.
    const mainRows = p.pool.filter((r) => r.main > 0);
    const sideRows = p.pool.filter((r) => r.side > 0);
    const tile = {
        focusId: focus?.cardId,
        onFocus: (id: string) => !drag && setFocusId(id),
        onAct: act,
        onDragStart: start,
        suppressClick,
        draggingId: drag?.cardId,
        disabled: p.submitting,
    };

    return (
        <ProtoSheet
            title="Sideboarding"
            subtitle={`${p.seatName} · before game ${p.gameNumber}`}
            footer={<ProtoReadyBar p={p} />}
            footerClassName={cn(
                "bg-surface-elevated py-3 md:py-4 shadow-[0_-12px_24px_-12px_rgba(0,0,0,.6)] transition-colors sm:px-6",
                p.sizeOk
                    ? "border-t-2 border-t-accent/50"
                    : "border-t-2 border-t-danger/60"
            )}
        >
            <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle/40 px-4 py-2 sm:px-5">
                <span className="text-[10px] uppercase tracking-wide text-text-muted">
                    Changes
                </span>
                <ProtoChanges p={p} />
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
                <DropZone
                    zone="main"
                    drag={drag}
                    row={dragRow}
                    className="min-w-0 flex-1"
                >
                    <section className="h-full overflow-auto py-3 pr-4 pl-3 sm:px-5">
                        <ZoneLabel count={p.mainCount}>Maindeck</ZoneLabel>
                        <div className="flex flex-wrap gap-5">
                            {groupBy(mainRows).map((g) => (
                                <Cascade
                                    key={g.group}
                                    title={g.group}
                                    count={g.rows.reduce(
                                        (n, r) => n + r.main,
                                        0
                                    )}
                                    rows={g.rows}
                                    zone="main"
                                    {...tile}
                                />
                            ))}
                        </div>
                    </section>
                </DropZone>
                <DropZone
                    zone="side"
                    drag={drag}
                    row={dragRow}
                    className="w-1/2 shrink-0 sm:w-[calc(180px+3rem)] border-l border-border-subtle/40 bg-surface-base/60 xl:w-[calc(360px+4.25rem)]"
                >
                    <section className="h-full overflow-auto py-3 pr-4 pl-3 sm:px-5">
                        <ZoneLabel count={p.sideCount}>Sideboard</ZoneLabel>
                        {sideRows.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border-subtle p-4 text-center text-xs text-text-disabled">
                                Empty — drag cards here
                            </div>
                        ) : (
                            <Cascade
                                title="All"
                                count={p.sideCount}
                                rows={sideRows}
                                zone="side"
                                split={wideSide}
                                {...tile}
                            />
                        )}
                    </section>
                </DropZone>
                {focus && (
                    <aside className="hidden w-[22rem] shrink-0 flex-col gap-3 overflow-hidden border-l border-border-subtle/40 p-3 lg:flex">
                        <ProtoPreview
                            cardId={focus.cardId}
                            className="min-h-0 flex-1"
                        />
                        <FocusActions
                            r={focus}
                            onAct={act}
                            disabled={p.submitting}
                        />
                    </aside>
                )}
            </div>
            {/* below lg there is no inspector and no action bar: tap = 1 copy,
                drag onto the "All N" pad = every copy. A "last tapped card"
                bar had no hover to follow, so it showed nothing useful. */}
            {drag && dragRow && <ProtoDragGhost drag={drag} row={dragRow} />}
            {inspectId && (
                <Inspect
                    row={p.pool.find((r) => r.cardId === inspectId)!}
                    order={[
                        ...mainRows,
                        ...sideRows.filter((r) => r.main === 0),
                    ]}
                    onGo={setInspectId}
                    onClose={() => setInspectId(null)}
                    onAct={act}
                    disabled={p.submitting}
                />
            )}
        </ProtoSheet>
    );
}

/** Phone card read: the deck builder's Inspect Overlay with the four moves.
 *  Prev / next walk the visible pool (Maindeck first, then Sideboard-only). */
function Inspect({
    row,
    order,
    onGo,
    onClose,
    onAct,
    disabled,
}: {
    row: PoolRow;
    order: PoolRow[];
    onGo: (id: string) => void;
    onClose: () => void;
    onAct: (r: PoolRow, dir: Dir, all: boolean) => void;
    disabled: boolean;
}) {
    const i = order.findIndex((r) => r.cardId === row.cardId);
    const step = (d: number) => {
        const n = order[i + d];
        if (n) onGo(n.cardId);
    };
    return (
        <InspectOverlay
            cardId={row.cardId}
            onClose={onClose}
            onStep={{ previous: () => step(-1), next: () => step(1) }}
            actions={[
                {
                    label: `All${row.side > 1 ? ` ${row.side}` : ""} → Maindeck`,
                    onSelect: () => onAct(row, "toMain", true),
                    disabled: disabled || row.side < 2,
                },
                {
                    label: "1 → Maindeck",
                    onSelect: () => onAct(row, "toMain", false),
                    disabled: disabled || row.side === 0,
                    primary: row.main === 0,
                },
                {
                    label: "1 → Sideboard",
                    onSelect: () => onAct(row, "toSide", false),
                    disabled: disabled || row.main === 0,
                    primary: row.main > 0,
                },
                {
                    label: `All${row.main > 1 ? ` ${row.main}` : ""} → Sideboard`,
                    onSelect: () => onAct(row, "toSide", true),
                    disabled: disabled || row.main < 2,
                },
            ]}
        />
    );
}

function ZoneLabel({
    children,
    count,
}: {
    children: React.ReactNode;
    count: number;
}) {
    return (
        <div className="mb-2 flex items-baseline gap-2 text-xs uppercase tracking-[0.18em] text-text-muted">
            {children}
            <span className="text-sm font-semibold tracking-normal text-parchment tabular-nums">
                {count}
            </span>
        </div>
    );
}

/** A zone that accepts drops. While a card from the OTHER zone is dragged it
 *  lights up and, for a pile of 2+, offers two pads: "1 copy" and "All N". */
function DropZone({
    zone,
    drag,
    row,
    className,
    children,
}: {
    zone: Zone;
    drag: DragInfo | null;
    row?: PoolRow;
    className?: string;
    children: React.ReactNode;
}) {
    const target = !!drag && drag.from !== zone;
    const over = target && drag.over === zone;
    const here = row && drag ? (drag.from === "main" ? row.main : row.side) : 0;
    const name = zone === "main" ? "Maindeck" : "Sideboard";
    return (
        <div
            data-drop-zone={zone}
            className={cn(
                "relative min-h-0 transition-colors",
                target && "bg-accent-soft/40",
                over && "bg-accent-soft",
                className
            )}
        >
            {children}
            {target && (
                <div
                    className={cn(
                        "pointer-events-none absolute inset-1.5 rounded-lg border-2 border-dashed transition-colors",
                        over ? "border-accent" : "border-accent/40"
                    )}
                />
            )}
            {target && here > 1 && (
                <div
                    className={cn(
                        "absolute inset-x-3 top-10 z-30 flex flex-col gap-2 sm:inset-x-4",
                        zone === "main" && "sm:flex-row"
                    )}
                >
                    <DropPad
                        zone={zone}
                        active={over && !drag.overAll && !drag.shift}
                        label={`1 copy → ${name}`}
                    />
                    <DropPad
                        zone={zone}
                        all
                        active={over && (drag.overAll || drag.shift)}
                        label={`All ${here} → ${name}`}
                    />
                </div>
            )}
        </div>
    );
}

function DropPad({
    zone,
    all,
    active,
    label,
}: {
    zone: Zone;
    all?: boolean;
    active: boolean;
    label: string;
}) {
    return (
        <div
            data-drop-zone={zone}
            data-drop-all={all ? "" : undefined}
            className={cn(
                "flex h-14 min-w-0 flex-1 shrink-0 basis-auto items-center justify-center rounded-lg border-2 px-2 text-center text-xs font-semibold sm:h-16 sm:px-3 sm:text-sm shadow-lg backdrop-blur transition-colors",
                active
                    ? "border-accent bg-accent text-surface-base"
                    : "border-accent/50 bg-surface-elevated/90 text-parchment"
            )}
        >
            {label}
        </div>
    );
}

type TileCtx = {
    focusId?: string;
    onFocus: (id: string) => void;
    onAct: (r: PoolRow, dir: Dir, all: boolean) => void;
    onDragStart: (e: React.PointerEvent, cardId: string, from: Zone) => void;
    suppressClick: React.RefObject<boolean>;
    draggingId?: string;
    disabled: boolean;
};

/** One type column: cards cascaded top-down, each showing its printed name
 *  bar; the last one shows whole. `split` breaks a long column into two. */
function Cascade({
    title,
    count,
    rows,
    zone,
    split,
    ...ctx
}: {
    title: string;
    count: number;
    rows: PoolRow[];
    zone: Zone;
    split?: boolean;
} & TileCtx) {
    const cols =
        split && rows.length > 6
            ? [
                  rows.slice(0, Math.ceil(rows.length / 2)),
                  rows.slice(Math.ceil(rows.length / 2)),
              ]
            : [rows];
    return (
        <div style={{ width: cols.length > 1 ? undefined : CARD_W }}>
            {title !== "All" && (
                <div
                    className="mb-1.5 flex items-baseline justify-between text-xs"
                    style={{ width: CARD_W }}
                >
                    <span className="text-parchment">{title}</span>
                    <span className="tabular-nums text-text-muted">
                        {count}
                    </span>
                </div>
            )}
            <div className="flex gap-5">
                {cols.map((col, ci) => (
                    <ol
                        key={ci}
                        className="flex flex-col"
                        style={{ width: CARD_W }}
                    >
                        {col.map((r, i) => (
                            <StackTile
                                key={r.cardId}
                                r={r}
                                zone={zone}
                                last={i === col.length - 1}
                                {...ctx}
                            />
                        ))}
                    </ol>
                ))}
            </div>
        </div>
    );
}

function StackTile({
    r,
    zone,
    last,
    focusId,
    onFocus,
    onAct,
    onDragStart,
    suppressClick,
    draggingId,
    disabled,
}: { r: PoolRow; zone: Zone; last: boolean } & TileCtx) {
    const here = zone === "main" ? r.main : r.side;
    const dir: Dir = zone === "main" ? "toSide" : "toMain";
    const focused = r.cardId === focusId;
    const lifted = r.cardId === draggingId;
    // Count badge carries the change, zone-relative: green = copies ARRIVED
    // here this window; red ring = some copies LEFT (the rest is still here).
    const gained = zone === "main" ? r.delta > 0 : r.delta < 0;
    const reduced = zone === "main" ? r.delta < 0 : r.delta > 0;
    return (
        <li
            className="group relative"
            style={{ height: last ? undefined : PEEK }}
            onDragStart={(e) => e.preventDefault()}
        >
            <button
                type="button"
                disabled={disabled}
                onPointerEnter={() => onFocus(r.cardId)}
                onFocus={() => onFocus(r.cardId)}
                onPointerDown={(e) =>
                    !disabled && onDragStart(e, r.cardId, zone)
                }
                onContextMenu={(e) => e.preventDefault()}
                onClick={(e) => {
                    if (suppressClick.current) return;
                    onAct(r, dir, e.shiftKey);
                }}
                aria-label={`${r.name}, ${here} ${here === 1 ? "copy" : "copies"}. Move one to the ${zone === "main" ? "Sideboard" : "Maindeck"}`}
                className={cn(
                    "relative block w-full cursor-grab touch-pan-y rounded-[4.5%] transition-transform duration-100 [-webkit-touch-callout:none] [-webkit-user-select:none] group-hover:-translate-y-1",
                    // focus ring only where the inspector it points at exists
                    focused &&
                        "lg:ring-2 lg:ring-accent lg:ring-offset-2 lg:ring-offset-surface",
                    lifted && "scale-[0.97] brightness-75"
                )}
                style={{
                    // a 2-copy+ pile shows a physical edge per extra copy
                    boxShadow:
                        here > 1
                            ? Array.from(
                                  { length: Math.min(here - 1, 3) },
                                  (_, k) =>
                                      `${(k + 1) * 2}px ${(k + 1) * 2}px 0 -1px rgba(0,0,0,.55), ${(k + 1) * 2}px ${(k + 1) * 2}px 0 0 rgba(255,255,255,.12)`
                              ).join(",")
                            : "0 2px 6px rgba(0,0,0,.5)",
                }}
            >
                <ProtoCardImg cardId={r.cardId} name={r.name} />
                <span
                    className={cn(
                        "absolute top-[5px] -right-2.5 min-w-[26px] rounded-full px-1.5 text-center text-[12px] font-bold leading-[20px] tabular-nums shadow-[0_1px_4px_rgba(0,0,0,.6)]",
                        gained
                            ? "bg-success text-surface-base"
                            : reduced
                              ? "bg-black/90 text-white ring-2 ring-danger"
                              : "bg-black/90 text-white ring-1 ring-white/35"
                    )}
                >
                    ×{here}
                </span>
            </button>
        </li>
    );
}

function FocusActions({
    r,
    onAct,
    disabled,
}: {
    r: PoolRow;
    onAct: (r: PoolRow, dir: Dir, all: boolean) => void;
    disabled: boolean;
}) {
    const btn =
        "inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-border-subtle bg-surface-elevated px-2 py-1.5 text-xs text-text transition-colors hover:border-accent/60 hover:bg-accent-soft disabled:pointer-events-none disabled:opacity-35";
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
                <span className="truncate text-parchment">{r.name}</span>
                <span className="tabular-nums text-text-muted">
                    Main <b className="text-text">{r.main}</b> · Side{" "}
                    <b className="text-text">{r.side}</b>
                </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-text-muted">
                        ← To Maindeck
                    </span>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            className={btn}
                            disabled={disabled || r.side === 0}
                            onClick={() => onAct(r, "toMain", false)}
                        >
                            <ArrowLeft className="size-3.5" /> 1
                        </button>
                        <button
                            type="button"
                            className={btn}
                            disabled={disabled || r.side < 2}
                            onClick={() => onAct(r, "toMain", true)}
                        >
                            <ChevronsLeft className="size-3.5" /> All{" "}
                            {r.side > 1 ? r.side : ""}
                        </button>
                    </div>
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-right text-[10px] uppercase tracking-wide text-text-muted">
                        To Sideboard →
                    </span>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            className={btn}
                            disabled={disabled || r.main === 0}
                            onClick={() => onAct(r, "toSide", false)}
                        >
                            1 <ArrowRight className="size-3.5" />
                        </button>
                        <button
                            type="button"
                            className={btn}
                            disabled={disabled || r.main < 2}
                            onClick={() => onAct(r, "toSide", true)}
                        >
                            All {r.main > 1 ? r.main : ""}{" "}
                            <ChevronsRight className="size-3.5" />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
