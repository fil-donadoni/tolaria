// PROTOTYPE — throwaway. Variant C "Ledger": ONE row per distinct card of the
// pool — Maindeck and Sideboard are not two places but two counts of the same
// card. A copy dial (one pip per physical copy: filled = Maindeck, hollow =
// Sideboard) replaces "move one / move all" with "how many do I want in?":
// tap pip 3 → 3 in the Maindeck; − / + nudge by one; the ends are "all".
//
// Phone-first: one scrolling list, a selected row opens the editing surfaces'
// own Inspect Overlay (the deck builder's full card read) with the dial's
// actions inside. Desktop adds a sticky preview pane (board dock body).
import { useMemo, useState } from "react";
import { Eye, Minus, Plus } from "lucide-react";
import ProtoSheet from "./proto-sheet";
import ProtoPreview from "./proto-preview";
import ProtoReadyBar from "./proto-ready-bar";
import ProtoCountPill from "./proto-count-pill";
import ProtoChanges from "./proto-changes";
import { groupBy, setMainCount, type PoolRow } from "./proto-model";
import type { ProtoVariantProps } from "./proto-types";
import InspectOverlay from "~/components/editing/inspect-overlay";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";
import { cn } from "~/lib/utils";

type Filter = "all" | "main" | "side" | "changed";
const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "Whole pool" },
    { key: "main", label: "In Maindeck" },
    { key: "side", label: "In Sideboard" },
    { key: "changed", label: "Changed" },
];

export default function VariantCLedger(p: ProtoVariantProps) {
    const [filter, setFilter] = useState<Filter>("all");
    const [sel, setSel] = useState<string>(p.pool[0]?.cardId ?? "");
    const [inspect, setInspect] = useState<string | null>(null);
    const rows = useMemo(
        () =>
            p.pool.filter((r) =>
                filter === "main"
                    ? r.main > 0
                    : filter === "side"
                      ? r.side > 0
                      : filter === "changed"
                        ? r.delta !== 0
                        : true
            ),
        [p.pool, filter]
    );
    const setMain = (r: PoolRow, n: number) =>
        p.setSplit((s) =>
            setMainCount(s, r.cardId, Math.max(0, Math.min(r.total, n)))
        );
    const selected = p.pool.find((r) => r.cardId === sel);
    const changedN = p.pool.filter((r) => r.delta !== 0).length;
    const flat = rows;
    const inspected = inspect ? p.pool.find((r) => r.cardId === inspect) : null;
    const step = (d: number) => {
        const i = flat.findIndex((r) => r.cardId === inspect);
        const n = flat[i + d];
        if (n) setInspect(n.cardId);
    };

    return (
        <ProtoSheet
            size="wide"
            title="Sideboarding"
            subtitle={`${p.seatName} · before game ${p.gameNumber}`}
            headerRight={
                <div className="flex items-center gap-2">
                    <ProtoCountPill
                        label="Maindeck"
                        value={p.mainCount}
                        of={`/ ${p.lockedSize}+`}
                        ok={p.sizeOk}
                    />
                    <ProtoCountPill label="Sideboard" value={p.sideCount} />
                </div>
            }
            footer={<ProtoReadyBar p={p} />}
        >
            <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                    <div
                        className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle/40 px-4 py-2 sm:px-5"
                        role="tablist"
                    >
                        {FILTERS.map((f) => (
                            <button
                                key={f.key}
                                type="button"
                                role="tab"
                                aria-selected={filter === f.key}
                                onClick={() => setFilter(f.key)}
                                className={cn(
                                    "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                                    filter === f.key
                                        ? "border-accent bg-accent text-surface-base"
                                        : "border-border-subtle text-text-muted hover:text-parchment"
                                )}
                            >
                                {f.label}
                                {f.key === "changed" && changedN > 0 && (
                                    <span className="ml-1 tabular-nums opacity-70">
                                        {changedN}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 sm:px-3">
                        {rows.length === 0 && (
                            <div className="p-6 text-center text-xs text-text-disabled">
                                Nothing here.
                            </div>
                        )}
                        {groupBy(rows).map((g) => (
                            <section key={g.group}>
                                <div className="sticky top-0 z-10 flex items-baseline justify-between bg-surface/95 px-2 pt-3 pb-1 backdrop-blur">
                                    <span className="text-xs uppercase tracking-[0.18em] text-text-muted">
                                        {g.group}
                                    </span>
                                    <span className="text-[11px] tabular-nums text-text-disabled">
                                        {g.rows.reduce((n, r) => n + r.main, 0)}{" "}
                                        main ·{" "}
                                        {g.rows.reduce((n, r) => n + r.side, 0)}{" "}
                                        side
                                    </span>
                                </div>
                                <ul className="flex flex-col">
                                    {g.rows.map((r) => (
                                        <LedgerRow
                                            key={r.cardId}
                                            r={r}
                                            selected={r.cardId === sel}
                                            onSelect={() => setSel(r.cardId)}
                                            onInspect={() =>
                                                setInspect(r.cardId)
                                            }
                                            setMain={(n) => setMain(r, n)}
                                            disabled={p.submitting}
                                        />
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                </div>
                <aside className="hidden w-[21rem] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border-subtle/40 p-3 md:flex">
                    {selected && <ProtoPreview cardId={selected.cardId} />}
                    <div className="rounded-md border border-border-subtle/60 p-3">
                        <div className="mb-2 text-[10px] uppercase tracking-wide text-text-muted">
                            This window
                        </div>
                        <ProtoChanges p={p} layout="list" />
                    </div>
                </aside>
            </div>
            {inspected && (
                <InspectOverlay
                    cardId={inspected.cardId}
                    onClose={() => setInspect(null)}
                    onStep={{ previous: () => step(-1), next: () => step(1) }}
                    actions={[
                        {
                            label: "All to Sideboard",
                            onSelect: () => setMain(inspected, 0),
                            disabled: inspected.main === 0,
                        },
                        {
                            label: "−1 Maindeck",
                            onSelect: () =>
                                setMain(inspected, inspected.main - 1),
                            disabled: inspected.main === 0,
                        },
                        {
                            label: "+1 Maindeck",
                            onSelect: () =>
                                setMain(inspected, inspected.main + 1),
                            disabled: inspected.side === 0,
                            primary: true,
                        },
                        {
                            label: "All to Maindeck",
                            onSelect: () => setMain(inspected, inspected.total),
                            disabled: inspected.side === 0,
                        },
                    ]}
                />
            )}
        </ProtoSheet>
    );
}

function LedgerRow({
    r,
    selected,
    onSelect,
    onInspect,
    setMain,
    disabled,
}: {
    r: PoolRow;
    selected: boolean;
    onSelect: () => void;
    onInspect: () => void;
    setMain: (n: number) => void;
    disabled: boolean;
}) {
    const img = resolveCardImageId(r.cardId);
    return (
        <li
            onPointerEnter={onSelect}
            onFocusCapture={onSelect}
            className={cn(
                "group flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors",
                selected ? "bg-accent-soft" : "hover:bg-surface-elevated/60",
                r.delta !== 0 &&
                    "shadow-[inset_3px_0_0] " +
                        (r.delta > 0 ? "shadow-success" : "shadow-danger")
            )}
        >
            <button
                type="button"
                onClick={onInspect}
                className="relative shrink-0 overflow-hidden rounded-sm"
                aria-label={`Inspect ${r.name}`}
            >
                {img ? (
                    <img
                        src={getArtCropImageUrl(img)}
                        alt=""
                        className="h-11 w-[3.6rem] object-cover"
                    />
                ) : (
                    <div className="h-11 w-[3.6rem] bg-surface-elevated" />
                )}
                <Eye className="absolute inset-0 m-auto size-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-90" />
            </button>
            <button
                type="button"
                onClick={onInspect}
                className="min-w-0 flex-1 text-left"
            >
                <div className="truncate text-sm text-parchment">{r.name}</div>
                <div className="truncate text-[11px] text-text-muted">
                    {r.typeLine} · MV {r.mv}
                </div>
            </button>
            {r.delta !== 0 && (
                <span
                    className={cn(
                        "hidden rounded-full px-1.5 text-[11px] font-bold leading-[18px] tabular-nums sm:inline",
                        r.delta > 0
                            ? "bg-success-soft text-success-strong"
                            : "bg-danger-soft text-danger-strong"
                    )}
                >
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                </span>
            )}
            <CopyDial r={r} setMain={setMain} disabled={disabled} />
        </li>
    );
}

/** − [pips] + with Main / Side counts at either end. */
function CopyDial({
    r,
    setMain,
    disabled,
}: {
    r: PoolRow;
    setMain: (n: number) => void;
    disabled: boolean;
}) {
    const nudge =
        "flex size-7 min-h-[var(--touch-min)] min-w-[var(--touch-min)] items-center justify-center rounded-md border border-border-subtle text-text-muted transition-colors hover:border-accent/60 hover:text-parchment disabled:pointer-events-none disabled:opacity-30";
    return (
        <div className="flex shrink-0 items-center gap-1.5">
            <button
                type="button"
                className={nudge}
                disabled={disabled || r.main === 0}
                onClick={() => setMain(r.main - 1)}
                aria-label={`One ${r.name} to the Sideboard`}
            >
                <Minus className="size-3.5" />
            </button>
            <div className="flex flex-col items-center">
                <div
                    className="flex gap-1"
                    role="group"
                    aria-label={`${r.name}: ${r.main} in Maindeck, ${r.side} in Sideboard`}
                >
                    {Array.from({ length: r.total }, (_, i) => {
                        const on = i < r.main;
                        const wasOn = i < r.startMain;
                        return (
                            <button
                                key={i}
                                type="button"
                                disabled={disabled}
                                onClick={() =>
                                    setMain(r.main === i + 1 ? i : i + 1)
                                }
                                aria-label={`${i + 1} in Maindeck`}
                                className={cn(
                                    "h-6 w-3.5 rounded-[3px] border transition-colors",
                                    on
                                        ? "border-accent bg-accent"
                                        : "border-border-strong bg-transparent hover:border-accent/70",
                                    on !== wasOn &&
                                        (on
                                            ? "ring-1 ring-success ring-offset-1 ring-offset-surface"
                                            : "border-danger/80 border-dashed")
                                )}
                            />
                        );
                    })}
                </div>
                <div className="mt-0.5 flex w-full justify-between gap-2 text-[10px] tabular-nums text-text-muted">
                    <span>
                        <b className="text-text">{r.main}</b> main
                    </span>
                    <span>{r.side} side</span>
                </div>
            </div>
            <button
                type="button"
                className={nudge}
                disabled={disabled || r.side === 0}
                onClick={() => setMain(r.main + 1)}
                aria-label={`One ${r.name} to the Maindeck`}
            >
                <Plus className="size-3.5" />
            </button>
        </div>
    );
}
