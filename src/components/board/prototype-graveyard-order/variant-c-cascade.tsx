// PROTOTYPE — throwaway. Variant C "Cascade": solitaire columns. Each card
// covers all but the name bar (top 20%) of the one below it in the pile;
// columns of 6 flow left→right, bottom→top, so the top card is the last tile
// of the last column, fully visible. Hover lifts a peeked card whole.
// Filter: a run of hidden cards collapses into ONE dashed strip ("#4–6 · 3
// hidden") the height of a name bar.
import type { ReactNode } from "react";
import { V4_COUNT_BADGE } from "~/lib/board-chrome-v4";
import type { CardInstance } from "~/types/game";
import {
    PLACEHOLDER_CLASS,
    TILE_VAR_CLASS,
    hiddenLabel,
    type ProtoSlot,
} from "./proto-model";

const PER_COLUMN = 6;

function chunk<T>(xs: T[], n: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
}

export default function VariantCCascade({
    slots,
    renderCard,
}: {
    slots: ProtoSlot[];
    renderCard: (c: CardInstance) => ReactNode;
}) {
    const columns = chunk(slots, PER_COLUMN);
    return (
        <div className={`${TILE_VAR_CLASS} py-4`}>
            <div className="mb-2 px-2 text-[10px] uppercase tracking-wide text-text-muted">
                Bottom ↘ top (read left → right, down each column)
            </div>
            <div className="flex flex-wrap justify-center gap-x-2 gap-y-4">
                {columns.map((col, ci) => (
                    <div key={ci} className="flex w-(--tile) flex-col">
                        {col.map((s, i) => {
                            const lift =
                                i === 0
                                    ? ""
                                    : "-mt-[calc(var(--tile)*1.4*0.8)]";
                            if (s.kind === "hidden") {
                                return (
                                    <div
                                        key={s.key}
                                        className={`relative z-20 ${i === 0 ? "" : "-mt-[calc(var(--tile)*1.4*0.8)]"} mb-[calc(var(--tile)*1.4*0.8)] flex h-[calc(var(--tile)*1.4*0.2)] w-full min-w-0 items-center justify-center overflow-hidden whitespace-nowrap text-[9px] tabular-nums sm:text-[10px] ${PLACEHOLDER_CLASS}`}
                                        title={`${hiddenLabel(s)} hidden`}
                                    >
                                        {s.count} hidden
                                    </div>
                                );
                            }
                            return (
                                <div
                                    key={s.key}
                                    className={`relative z-10 ${lift} hover:z-30`}
                                >
                                    {renderCard(s.card)}
                                    {s.pos === 1 && (
                                        <span
                                            className={`pointer-events-none absolute -bottom-2 right-1 z-10 ${V4_COUNT_BADGE}`}
                                        >
                                            Top
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}
