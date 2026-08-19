// PROTOTYPE — throwaway. Split out of touch-builder-surface (one component per file).
import { cn } from "~/lib/utils";
import { useMemo } from "react";
import {
    BUCKETS,
    bucketOf,
    type Bucket,
    type ProtoCard,
    type Zone,
} from "./mock-pool";
import type { GestureModel } from "./use-touch-move-engine";
import TouchCardTile from "./touch-card-tile";

export default function TouchZonePane({
    zone,
    cards,
    landscape,
    model,
    selectedKey,
    overId,
    armed,
    cardProps,
    handleProps,
    zoneProps,
}: {
    zone: Zone;
    cards: ProtoCard[];
    landscape: boolean;
    model: GestureModel;
    selectedKey: string | null;
    overId: string | null;
    armed: boolean;
    cardProps: (key: string) => Record<string, unknown>;
    handleProps: (key: string) => Record<string, unknown>;
    zoneProps: (id: string) => Record<string, unknown>;
}) {
    const buckets = useMemo(() => {
        const m = new Map<Bucket, ProtoCard[]>();
        for (const b of BUCKETS) m.set(b, []);
        for (const c of cards) m.get(bucketOf(c))!.push(c);
        return m;
    }, [cards]);

    if (landscape) {
        const cols = BUCKETS.filter(
            (b) => (buckets.get(b)?.length ?? 0) > 0 || b === "3"
        );
        return (
            <div
                className="grid h-full gap-2 overflow-y-auto p-2"
                style={{
                    gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))`,
                    alignContent: "start",
                }}
            >
                {cols.map((b) => {
                    const list = buckets.get(b) ?? [];
                    const id = `col:${zone}:${b}`;
                    return (
                        <div
                            key={b}
                            {...zoneProps(id)}
                            className={cn(
                                "relative min-h-[120px] rounded-md p-1",
                                overId === id && "bg-accent/20",
                                armed && "ring-1 ring-signal-pending/50"
                            )}
                        >
                            <div className="mb-1 text-[11px] text-text-muted">
                                {b} · {list.length}
                            </div>
                            <div
                                className="relative"
                                style={{
                                    height: list.length
                                        ? 64 * 1.4 + (list.length - 1) * 22
                                        : 44,
                                }}
                            >
                                {list.map((c, i) => (
                                    <TouchCardTile
                                        key={c.key}
                                        card={c}
                                        width={64}
                                        selected={selectedKey === c.key}
                                        showHandle={model === "C"}
                                        cardProps={cardProps(c.key)}
                                        handleProps={handleProps(c.key)}
                                        className="absolute left-0"
                                        style={{ top: i * 22 }}
                                    />
                                ))}
                                {list.length === 0 ? (
                                    <div className="h-11 rounded border border-dashed border-border-subtle text-center text-[10px] leading-[44px] text-text-disabled">
                                        drop
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    // portrait: MV rows, duplicates collapsed
    return (
        <div className="flex h-full flex-col gap-1.5 overflow-y-auto p-2">
            {BUCKETS.filter(
                (b) => (buckets.get(b)?.length ?? 0) > 0 || b === "5"
            ).map((b) => {
                const list = buckets.get(b) ?? [];
                const groups = new Map<string, ProtoCard[]>();
                for (const c of list)
                    groups.set(c.cardId, [...(groups.get(c.cardId) ?? []), c]);
                const id = `row:${zone}:${b}`;
                return (
                    <div
                        key={b}
                        {...zoneProps(id)}
                        className={cn(
                            "flex items-center gap-1.5 rounded-md",
                            overId === id && "bg-accent/20",
                            armed && "ring-1 ring-signal-pending/50"
                        )}
                    >
                        <span className="w-10 shrink-0 text-[11px] font-bold tracking-wide text-text-muted">
                            {b}
                        </span>
                        <span className="w-4 shrink-0 text-right text-[11px] text-text-disabled">
                            {list.length}
                        </span>
                        <div
                            className="flex min-h-[82px] flex-1 gap-1.5 overflow-x-auto py-1 [scrollbar-width:none]"
                            style={{ overscrollBehaviorX: "contain" }}
                        >
                            {[...groups.values()].map((g) => {
                                const top =
                                    g.find((c) => c.key === selectedKey) ??
                                    g[0];
                                return (
                                    <TouchCardTile
                                        key={top.key}
                                        card={top}
                                        width={58}
                                        copies={g.length}
                                        selected={selectedKey === top.key}
                                        showHandle={model === "C"}
                                        cardProps={cardProps(top.key)}
                                        handleProps={handleProps(top.key)}
                                    />
                                );
                            })}
                            {list.length === 0 ? (
                                <div className="flex h-[74px] flex-1 items-center justify-center rounded border border-dashed border-border-subtle text-[11px] text-text-disabled">
                                    drop here
                                </div>
                            ) : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
