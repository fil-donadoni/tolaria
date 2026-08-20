import { useRef } from "react";
import type { CardIndexEntry } from "./useCardSearch";
import EmptyState from "~/components/ui/empty-state";
import ResultCard from "./result-card";
import { useGridWindow } from "./useGridWindow";

interface ResultsGridProps {
    entries: CardIndexEntry[] | undefined;
    /** True when no filter is set — show prompt instead of cards. */
    idle: boolean;
    /** Active set filter — forwarded to each card to pick its default edition. */
    activeSets: string[];
    /** False in manual mode, where a card the GRE does not implement is still
     *  fully playable (ADR 0080) and must stay selectable. */
    enforceAvailability: boolean;
    onAdd: (printId: string, cardName: string) => void;
}

export default function ResultsGrid({
    entries,
    idle,
    activeSets,
    enforceAvailability,
    onAdd,
}: ResultsGridProps) {
    // Windowed rendering (issue #505 / PRD #501 originally grew a batch per
    // scroll; that made the mounted count grow without bound and a 540-card
    // cube stopped painting). Only the rows near the viewport are mounted —
    // see `gridWindow.ts` for why the ceiling had to become a bound.
    const outerRef = useRef<HTMLDivElement | null>(null);
    const innerRef = useRef<HTMLDivElement | null>(null);
    const { start, end, offsetTop, totalHeight } = useGridWindow(
        entries?.length ?? 0,
        outerRef,
        innerRef,
        entries
    );
    const visible = entries ? entries.slice(start, end) : [];
    // Before the first cell exists there is nothing to measure, so the seed
    // slice renders in normal flow; the spacer and the absolute positioning
    // only switch on once the geometry is known.
    const measured = totalHeight > 0;

    if (entries === undefined) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
                Loading card library…
            </div>
        );
    }

    if (idle) {
        return (
            <div className="flex h-full items-center justify-center">
                <EmptyState
                    message="Search or pick a filter to see cards."
                    description="Name, color, type, or mana value all narrow the list."
                    className="text-center"
                />
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <EmptyState message="No cards match these filters." />
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <div className="sticky top-0 z-10 border-b border-border-subtle/30 bg-surface/80 px-2 py-1.5 text-xs text-text-muted backdrop-blur">
                {entries.length} {entries.length === 1 ? "card" : "cards"} found
            </div>
            {/* The spacer carries the FULL grid's height so the scrollbar
                reflects the whole match set; the mounted rows are positioned
                inside it at their real offset. */}
            <div
                ref={outerRef}
                className="relative p-2"
                style={measured ? { height: totalHeight } : undefined}
            >
                <div
                    ref={innerRef}
                    className={
                        measured
                            ? "absolute inset-x-2 flex flex-wrap gap-2 md:gap-3"
                            : "flex flex-wrap gap-2 md:gap-3"
                    }
                    style={measured ? { top: offsetTop } : undefined}
                >
                    {visible.map((entry) => (
                        <ResultCard
                            key={entry.cardId}
                            entry={entry}
                            activeSets={activeSets}
                            enforceAvailability={enforceAvailability}
                            onAdd={onAdd}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
