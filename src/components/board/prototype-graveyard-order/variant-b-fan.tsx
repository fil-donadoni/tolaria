// PROTOTYPE — throwaway. Variant B "Fan": one horizontal row like the library
// browse (top on the RIGHT, ADR 0026 parity), 55% overlap, opens scrolled to
// the top end. Filter: one card-shaped outline per hidden card (thin
// border, no visible fill), showing a 12% sliver instead of a card's 45%.
import { useEffect, useRef, type ReactNode } from "react";
import { V4_COUNT_BADGE } from "~/lib/board-chrome-v4";
import type { CardInstance } from "~/types/game";
import { TILE_VAR_CLASS, hiddenLabel, type ProtoSlot } from "./proto-model";

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
                    {slots.map((s, i) => {
                        // Owner round 1: a hidden card is a card-shaped
                        // outline, thin border, no visible fill. Every item
                        // shows the strip up to the NEXT item: a real card
                        // 45%, a hidden one only 12% — so the item AFTER a
                        // placeholder steps in tight. The outline's fill is
                        // the dialog surface (reads as empty, but occludes
                        // the item below like a card would).
                        const afterHidden = slots[i - 1]?.kind === "hidden";
                        const ml = afterHidden
                            ? "ml-[calc(var(--tile)*-0.88)]"
                            : "ml-[calc(var(--tile)*-0.55)]";
                        return s.kind === "card" ? (
                            <div
                                key={s.key}
                                className={`relative ${ml} w-(--tile) shrink-0 hover:z-30 [&>div]:w-full!`}
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
                            <div
                                key={s.key}
                                className={`relative ${ml} aspect-5/7 w-(--tile) shrink-0 self-start card-corner border border-border-strong bg-surface`}
                                title={`Hidden: ${hiddenLabel(s)}`}
                            />
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
