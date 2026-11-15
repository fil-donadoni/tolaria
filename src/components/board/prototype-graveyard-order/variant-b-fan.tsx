// PROTOTYPE — throwaway. Variant B "Fan": one horizontal row like the library
// browse (top on the RIGHT, ADR 0026 parity), 55% overlap, opens scrolled to
// the top end. Filter: a run of hidden cards collapses into ONE narrow
// dashed slot carrying its count ("3 hidden").
import { useEffect, useRef, type ReactNode } from "react";
import { V4_COUNT_BADGE } from "~/lib/board-chrome-v4";
import type { CardInstance } from "~/types/game";
import {
    PLACEHOLDER_CLASS,
    TILE_VAR_CLASS,
    hiddenLabel,
    type ProtoSlot,
} from "./proto-model";

export default function VariantBFan({
    slots,
    renderCard,
}: {
    slots: ProtoSlot[];
    renderCard: (c: CardInstance) => ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const raf = requestAnimationFrame(() =>
            el.scrollTo({ left: el.scrollWidth, behavior: "instant" })
        );
        return () => cancelAnimationFrame(raf);
    }, [slots.length]);
    return (
        <div className={`${TILE_VAR_CLASS} [--tile:6rem] sm:[--tile:9rem]`}>
            <div className="mt-3 flex justify-between px-2 text-[10px] uppercase tracking-wide text-text-muted">
                <span>← Bottom</span>
                <span>Top →</span>
            </div>
            <div ref={ref} className="overflow-x-auto px-2 pt-3 pb-6">
                <div className="mx-auto flex w-max pl-[calc(var(--tile)*0.55)]">
                    {slots.map((s) =>
                        s.kind === "card" ? (
                            <div
                                key={s.key}
                                className="relative ml-[calc(var(--tile)*-0.55)] w-(--tile) shrink-0 hover:z-30 [&>div]:w-full!"
                            >
                                {renderCard(s.card)}
                                {s.pos === 1 && (
                                    <span
                                        className={`pointer-events-none absolute -top-2 right-1 z-10 ${V4_COUNT_BADGE}`}
                                    >
                                        Top
                                    </span>
                                )}
                            </div>
                        ) : (
                            // Hidden run: not overlapped — it is a gap in the
                            // fan, so the cards either side split apart.
                            <div
                                key={s.key}
                                className={`relative z-0 mr-[calc(var(--tile)*0.55)] flex aspect-[2/7] w-[calc(var(--tile)*0.4)] shrink-0 flex-col items-center justify-center gap-1 self-start text-center text-[10px] leading-tight ${PLACEHOLDER_CLASS}`}
                                title={`${s.count} hidden (${hiddenLabel(s)})`}
                            >
                                <span className="text-sm font-bold tabular-nums">
                                    {s.count}
                                </span>
                                <span>hidden</span>
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}
