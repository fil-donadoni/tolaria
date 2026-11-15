// PROTOTYPE — throwaway. Variant B "Swap bench": sideboarding is a TRADE —
// N out, N in. The Sideboard sits on top as a shelf of whole cards (it is the
// reason the window exists); the Maindeck below is type rows of FANNED piles,
// one card per physical copy, so the copy count is something you see, not a
// number you read.
//
// Copy gesture: you PICK copies before anything moves. Each click on a pile
// lifts one more copy (2 of 4…); "All" lifts the whole pile; the lifted ones
// gather in the swap bar, which commits them in one press ("Swap 2 ⇄ 2").
// Preview: the board's hover-intent model — dwell 250 ms, close grace 120 ms —
// opening the dock's own preview body beside the hovered card.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownUp, X } from "lucide-react";
import ProtoSheet from "./proto-sheet";
import ProtoCardImg from "./proto-card-img";
import ProtoPreview from "./proto-preview";
import ProtoReadyBar from "./proto-ready-bar";
import ProtoCountPill from "./proto-count-pill";
import ProtoChanges from "./proto-changes";
import { groupBy, moveN, type PoolRow } from "./proto-model";
import type { ProtoVariantProps } from "./proto-types";
import {
    HOVER_DWELL_MS,
    HOVER_GRACE_MS,
} from "~/components/cards/card-preview";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

type Zone = "main" | "side";
type Picks = Record<string, number>; // cardId -> copies lifted
type Hover = { cardId: string; rect: DOMRect } | null;

export default function VariantBBench(p: ProtoVariantProps) {
    const [outPicks, setOut] = useState<Picks>({});
    const [inPicks, setIn] = useState<Picks>({});
    const hover = useDwellPreview();

    const pick = (zone: Zone, r: PoolRow, all: boolean) => {
        const have = zone === "main" ? r.main : r.side;
        const set = zone === "main" ? setOut : setIn;
        set((m) => {
            const cur = m[r.cardId] ?? 0;
            const next = all
                ? cur === have
                    ? 0
                    : have
                : cur >= have
                  ? 0
                  : cur + 1;
            const rest = { ...m };
            delete rest[r.cardId];
            return next === 0 ? rest : { ...rest, [r.cardId]: next };
        });
    };
    const unpick = (zone: Zone, id: string) =>
        (zone === "main" ? setOut : setIn)((m) => {
            const rest = { ...m };
            delete rest[id];
            return rest;
        });
    const nOut = Object.values(outPicks).reduce((a, b) => a + b, 0);
    const nIn = Object.values(inPicks).reduce((a, b) => a + b, 0);
    const after = p.mainCount - nOut + nIn;
    const commit = () => {
        p.setSplit((s) => {
            let next = s;
            for (const [id, n] of Object.entries(outPicks))
                next = moveN(next, id, "toSide", n);
            for (const [id, n] of Object.entries(inPicks))
                next = moveN(next, id, "toMain", n);
            return next;
        });
        setOut({});
        setIn({});
    };
    const label =
        nOut && nIn
            ? `Swap ${nOut} ⇄ ${nIn}`
            : nOut
              ? `Take out ${nOut}`
              : nIn
                ? `Bring in ${nIn}`
                : "Pick cards to swap";
    const byName = (id: string) =>
        p.pool.find((r) => r.cardId === id)?.name ?? id;

    const sideRows = p.pool.filter((r) => r.side > 0);
    return (
        <ProtoSheet
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
            footer={<ProtoReadyBar p={p} leading={<ProtoChanges p={p} />} />}
        >
            <div className="min-h-0 flex-1 overflow-auto">
                {/* Sideboard shelf */}
                <section className="border-b border-border-subtle/40 bg-surface-base/60 px-4 pt-3 pb-4 sm:px-5">
                    <ShelfLabel
                        title="Sideboard"
                        hint="click to pick a copy to bring in"
                    />
                    <div className="flex flex-wrap gap-x-5 gap-y-4">
                        {sideRows.length === 0 && (
                            <Empty>Sideboard is empty</Empty>
                        )}
                        {sideRows.map((r) => (
                            <Fan
                                key={r.cardId}
                                r={r}
                                zone="side"
                                w={118}
                                picked={inPicks[r.cardId] ?? 0}
                                onPick={pick}
                                hover={hover}
                                disabled={p.submitting}
                            />
                        ))}
                    </div>
                </section>

                {/* Swap bar — sticky so the picks stay in sight while scrolling the deck */}
                <div className="sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-border-subtle/60 bg-surface/95 px-4 py-2.5 backdrop-blur sm:px-5">
                    <PickList
                        title="Out"
                        tone="out"
                        picks={outPicks}
                        name={byName}
                        onRemove={(id) => unpick("main", id)}
                    />
                    <Button
                        type="button"
                        variant={nOut || nIn ? "primary" : "secondary"}
                        disabled={!(nOut || nIn) || p.submitting}
                        onClick={commit}
                        className="min-w-40"
                    >
                        <ArrowDownUp className="size-4" /> {label}
                    </Button>
                    <PickList
                        title="In"
                        tone="in"
                        picks={inPicks}
                        name={byName}
                        onRemove={(id) => unpick("side", id)}
                    />
                    <span
                        className={cn(
                            "ml-auto text-xs tabular-nums",
                            after >= p.lockedSize
                                ? "text-text-muted"
                                : "text-danger-strong"
                        )}
                    >
                        Maindeck after swap: <b>{after}</b> / {p.lockedSize}+
                    </span>
                </div>

                {/* Maindeck rows */}
                <section className="px-4 pt-3 pb-5 sm:px-5">
                    <ShelfLabel
                        title="Maindeck"
                        hint="click: pick one more copy · All: pick the pile"
                    />
                    <div className="flex flex-col gap-4">
                        {groupBy(p.pool.filter((r) => r.main > 0)).map((g) => (
                            <div key={g.group} className="flex gap-4">
                                <div className="w-20 shrink-0 pt-1 text-xs">
                                    <div className="text-parchment">
                                        {g.group}
                                    </div>
                                    <div className="tabular-nums text-text-muted">
                                        {g.rows.reduce((n, r) => n + r.main, 0)}
                                    </div>
                                </div>
                                <div className="flex min-w-0 flex-1 flex-wrap gap-x-5 gap-y-4">
                                    {g.rows.map((r) => (
                                        <Fan
                                            key={r.cardId}
                                            r={r}
                                            zone="main"
                                            w={96}
                                            picked={outPicks[r.cardId] ?? 0}
                                            onPick={pick}
                                            hover={hover}
                                            disabled={p.submitting}
                                        />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </div>
            {hover.state && (
                <FloatingPreview
                    state={hover.state}
                    onEnter={hover.cancelClose}
                    onLeave={hover.scheduleClose}
                />
            )}
        </ProtoSheet>
    );
}

function ShelfLabel({ title, hint }: { title: string; hint: string }) {
    return (
        <div className="mb-2 flex items-baseline gap-3">
            <span className="text-xs uppercase tracking-[0.18em] text-text-muted">
                {title}
            </span>
            <span className="hidden text-[11px] text-text-disabled sm:inline">
                {hint}
            </span>
        </div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <div className="py-6 text-xs text-text-disabled">{children}</div>;
}

/** A pile drawn as one card per copy, fanned to the right. Picked copies are
 *  the RIGHTMOST ones, lifted and ringed. */
function Fan({
    r,
    zone,
    w,
    picked,
    onPick,
    hover,
    disabled,
}: {
    r: PoolRow;
    zone: Zone;
    w: number;
    picked: number;
    onPick: (zone: Zone, r: PoolRow, all: boolean) => void;
    hover: ReturnType<typeof useDwellPreview>;
    disabled: boolean;
}) {
    const n = zone === "main" ? r.main : r.side;
    const step = Math.min(18, w * 0.18);
    const delta = r.delta; // always the Maindeck view
    return (
        <div className="flex flex-col items-start gap-1">
            <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(zone, r, false)}
                onPointerEnter={(e) => hover.open(r.cardId, e.currentTarget)}
                onPointerLeave={hover.scheduleClose}
                aria-label={`${r.name}: ${n} ${n === 1 ? "copy" : "copies"}, ${picked} picked. Pick one more`}
                className="relative block"
                style={{ width: w + step * (n - 1), height: w * 1.3934 + 12 }}
            >
                {Array.from({ length: n }, (_, i) => {
                    const lifted = i >= n - picked;
                    return (
                        <span
                            key={i}
                            className={cn(
                                "absolute top-3 block rounded-[4.5%] shadow-[0_2px_6px_rgba(0,0,0,.55)] transition-transform duration-100",
                                lifted &&
                                    "-translate-y-3 ring-2 ring-signal-actionable brightness-110"
                            )}
                            style={{ left: i * step, width: w }}
                        >
                            <ProtoCardImg cardId={r.cardId} name={r.name} />
                        </span>
                    );
                })}
                {picked > 0 && (
                    <span className="absolute top-0 right-0 z-20 rounded-full bg-signal-actionable px-2 text-[11px] font-bold leading-[20px] text-surface-base shadow">
                        {picked}/{n} {zone === "main" ? "out" : "in"}
                    </span>
                )}
                {delta !== 0 && (
                    <span
                        className={cn(
                            "absolute -top-1 -left-1 z-10 rounded-full px-1.5 text-[11px] font-bold leading-[18px] shadow",
                            delta > 0
                                ? "bg-success text-surface-base"
                                : "bg-danger text-white"
                        )}
                    >
                        {zone === "main"
                            ? delta > 0
                                ? `+${delta}`
                                : delta
                            : delta > 0
                              ? `in ${delta}`
                              : `out ${-delta}`}
                    </span>
                )}
            </button>
            <div
                className="flex items-center gap-1.5 text-[11px]"
                style={{ width: w + step * (n - 1) }}
            >
                <span className="min-w-0 flex-1 truncate text-text-muted">
                    <b className="text-text tabular-nums">{n}×</b> {r.name}
                </span>
                {n > 1 && (
                    <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onPick(zone, r, true)}
                        className={cn(
                            "shrink-0 rounded-sm border px-1.5 leading-[18px] transition-colors",
                            picked === n
                                ? "border-signal-actionable bg-signal-actionable/20 text-signal-actionable-strong"
                                : "border-border-subtle text-text-muted hover:text-parchment"
                        )}
                    >
                        All
                    </button>
                )}
            </div>
        </div>
    );
}

function PickList({
    title,
    tone,
    picks,
    name,
    onRemove,
}: {
    title: string;
    tone: "in" | "out";
    picks: Picks;
    name: (id: string) => string;
    onRemove: (id: string) => void;
}) {
    const entries = Object.entries(picks);
    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <span
                className={cn(
                    "text-[10px] uppercase tracking-wide",
                    tone === "out"
                        ? "text-danger-strong"
                        : "text-success-strong"
                )}
            >
                {title}
            </span>
            {entries.length === 0 ? (
                <span className="text-xs text-text-disabled">—</span>
            ) : (
                entries.map(([id, n]) => (
                    <span
                        key={id}
                        className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-elevated py-0.5 pr-1 pl-2 text-xs"
                    >
                        <b className="tabular-nums">{n}</b>{" "}
                        <span className="max-w-32 truncate">{name(id)}</span>
                        <button
                            type="button"
                            onClick={() => onRemove(id)}
                            aria-label={`Unpick ${name(id)}`}
                            className="rounded-full p-0.5 text-text-muted hover:text-parchment"
                        >
                            <X className="size-3" />
                        </button>
                    </span>
                ))
            )}
        </div>
    );
}

/** Board hover-intent: dwell to open, grace to close, the panel holds itself open. */
function useDwellPreview() {
    const [state, setState] = useState<Hover>(null);
    const dwell = useRef<number | undefined>(undefined);
    const grace = useRef<number | undefined>(undefined);
    const cancelClose = useCallback(
        () => window.clearTimeout(grace.current),
        []
    );
    const scheduleClose = useCallback(() => {
        window.clearTimeout(dwell.current);
        window.clearTimeout(grace.current);
        grace.current = window.setTimeout(() => setState(null), HOVER_GRACE_MS);
    }, []);
    const open = useCallback((cardId: string, el: HTMLElement) => {
        window.clearTimeout(grace.current);
        window.clearTimeout(dwell.current);
        const go = () => setState({ cardId, rect: el.getBoundingClientRect() });
        // already showing one → switch at once (no second dwell)
        setState((s) => {
            if (s) {
                queueMicrotask(go);
                return s;
            }
            dwell.current = window.setTimeout(go, HOVER_DWELL_MS);
            return s;
        });
    }, []);
    useEffect(
        () => () => {
            window.clearTimeout(dwell.current);
            window.clearTimeout(grace.current);
        },
        []
    );
    return { state, open, scheduleClose, cancelClose };
}

function FloatingPreview({
    state,
    onEnter,
    onLeave,
}: {
    state: NonNullable<Hover>;
    onEnter: () => void;
    onLeave: () => void;
}) {
    const W = 340;
    const { rect } = state;
    const right = rect.right + 12 + W < window.innerWidth;
    const left = right ? rect.right + 12 : Math.max(8, rect.left - 12 - W);
    const top = Math.min(Math.max(8, rect.top - 40), window.innerHeight - 560);
    return (
        <div
            className="pointer-events-none fixed z-[60]"
            style={{
                left,
                top: Math.max(8, top),
                width: W,
                maxHeight: "calc(100dvh - 16px)",
            }}
        >
            <ProtoPreview
                cardId={state.cardId}
                className="pointer-events-auto max-h-[calc(100dvh-16px)]"
                onPointerEnter={onEnter}
                onPointerLeave={onLeave}
            />
        </div>
    );
}
