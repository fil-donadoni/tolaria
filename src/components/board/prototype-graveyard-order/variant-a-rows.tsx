// PROTOTYPE — throwaway. Variant A "Rows": the grid kept, cards in wrapping
// rows bottom→top, each overlapping its left neighbour by 30% (name and cost
// of every card stay legible). Top card = last tile, bottom-right, never
// covered. Filter: ONE dashed placeholder per hidden card, same overlap.
import { useEffect, useRef, type ReactNode } from "react";
import { V4_COUNT_BADGE } from "~/lib/board-chrome-v4";
import type { CardInstance } from "~/types/game";
import {
    PLACEHOLDER_CLASS,
    TILE_VAR_CLASS,
    type ProtoSlot,
} from "./proto-model";

export default function VariantARows({
    slots,
    renderCard,
}: {
    slots: ProtoSlot[];
    renderCard: (c: CardInstance) => ReactNode;
}) {
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const raf = requestAnimationFrame(() =>
            endRef.current?.scrollIntoView({ block: "end" })
        );
        return () => cancelAnimationFrame(raf);
    }, [slots.length]);
    return (
        <div className={`${TILE_VAR_CLASS} py-4`}>
            <div className="mb-2 flex justify-between px-2 text-[10px] uppercase tracking-wide text-text-muted">
                <span>Bottom</span>
                <span>Top ↘</span>
            </div>
            <div className="flex flex-wrap justify-center gap-y-4 pl-[calc(var(--tile)*0.3)]">
                {slots.map((s) => (
                    <div
                        key={s.key}
                        className={`relative ml-[calc(var(--tile)*-0.3)] w-(--tile) shrink-0 hover:z-30 ${s.kind === "card" ? "z-10" : "z-0"} [&>div]:w-full!`}
                    >
                        {s.kind === "card" ? (
                            renderCard(s.card)
                        ) : (
                            <div
                                className={`flex aspect-5/7 w-full items-start justify-center pt-1 text-[10px] tabular-nums ${PLACEHOLDER_CLASS}`}
                            >
                                #{s.from}
                            </div>
                        )}
                        {s.kind === "card" && (
                            <span
                                className={`pointer-events-none absolute -bottom-2 left-1 z-10 ${s.pos === 1 ? V4_COUNT_BADGE : "rounded-full bg-surface-base/85 px-1 text-[10px] tabular-nums text-text-muted"}`}
                            >
                                {s.pos === 1 ? "Top" : `#${s.pos}`}
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <div ref={endRef} />
        </div>
    );
}
