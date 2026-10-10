// PROTOTYPE — throwaway. A titled row of piles. `scroll` makes the row its
// own horizontal scroller (snap per pile, the page never scrolls sideways);
// otherwise the piles wrap.
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import type { ProtoCard } from "../proto-cards";
import type { Column } from "./builder-data";
import PileColumn from "./pile-column";

export default function PileRow({
    title,
    count,
    accent,
    columns,
    onCardClick,
    scroll = true,
    showHeaders = true,
    empty = "Nothing here",
    aside,
    className,
}: {
    title: string;
    count: number;
    /** Left rule colour — tells the creature row from the spell row. */
    accent: "creature" | "spell" | "side";
    columns: Column[];
    onCardClick: (card: ProtoCard, el: Element) => void;
    scroll?: boolean;
    showHeaders?: boolean;
    empty?: string;
    aside?: ReactNode;
    className?: string;
}) {
    return (
        <section className={cn("flex min-w-0 flex-col gap-2", className)}>
            <header className="flex items-center gap-2">
                <span
                    aria-hidden
                    className={cn(
                        "h-4 w-1 rounded-full",
                        accent === "creature" && "bg-emerald-400/80",
                        accent === "spell" && "bg-sky-400/80",
                        accent === "side" && "bg-text-disabled"
                    )}
                />
                <h3 className="font-display text-sm tracking-wide text-parchment">
                    {title}
                </h3>
                <span className="rounded-full bg-surface-elevated/60 px-1.5 text-[11px] tabular-nums text-text-muted">
                    {count}
                </span>
                {aside && <div className="ml-auto">{aside}</div>}
            </header>
            {columns.length === 0 ? (
                <p className="rounded-sm border border-dashed border-border-subtle/40 px-3 py-4 text-center text-xs text-text-muted">
                    {empty}
                </p>
            ) : (
                <div
                    data-hscroll={scroll || undefined}
                    className={cn(
                        "flex gap-2 pb-1 sm:gap-3",
                        scroll
                            ? "snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
                            : "flex-wrap"
                    )}
                >
                    {columns.map((col) => (
                        <div key={col.key} className="snap-start">
                            <PileColumn
                                column={col}
                                onCardClick={onCardClick}
                                showHeader={showHeaders}
                            />
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
