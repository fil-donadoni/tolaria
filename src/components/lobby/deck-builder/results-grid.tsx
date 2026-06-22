import { useEffect, useRef } from "react";
import type { CardIndexEntry } from "./useCardSearch";
import ResultCard from "./result-card";
import { usePagedEntries } from "./usePagedEntries";

interface ResultsGridProps {
    entries: CardIndexEntry[] | undefined;
    /** True when no filter is set — show prompt instead of cards. */
    idle: boolean;
    /** Active set filter — forwarded to each card to pick its default edition. */
    activeSets: string[];
    onAdd: (printId: string, cardName: string) => void;
}

export default function ResultsGrid({
    entries,
    idle,
    activeSets,
    onAdd,
}: ResultsGridProps) {
    // Issue #505 / PRD #501: render a bounded batch and grow it as the user
    // scrolls, so the grid never has to render (and image-fetch) a thousand
    // matches at once. The header below still reports the true filtered total.
    const { visible, hasMore, loadMore } = usePagedEntries(entries);

    // IntersectionObserver sentinel: when the element near the grid bottom
    // enters the viewport, append the next batch. Thin glue — not unit-tested;
    // the slice logic lives in `usePagedEntries`.
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore) return;
        const observer = new IntersectionObserver(
            (observed) => {
                if (observed.some((e) => e.isIntersecting)) loadMore();
            },
            { rootMargin: "200px" }
        );
        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, loadMore, visible.length]);

    if (entries === undefined) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
                Loading card library…
            </div>
        );
    }

    if (idle) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-sm text-text-muted">
                <p>Search or pick a filter to see cards.</p>
                <p className="text-xs text-text-disabled">
                    Name, color, type, or mana value all narrow the list.
                </p>
            </div>
        );
    }

    if (entries.length === 0) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
                No cards match these filters.
            </div>
        );
    }

    return (
        <div className="flex flex-col">
            <div className="sticky top-0 z-10 border-b border-border-subtle/30 bg-surface/80 px-2 py-1.5 text-xs text-text-muted backdrop-blur">
                {entries.length} {entries.length === 1 ? "card" : "cards"} found
            </div>
            <div className="flex flex-wrap gap-2 p-2 md:gap-3">
                {visible.map((entry) => (
                    <ResultCard
                        key={entry.cardId}
                        entry={entry}
                        activeSets={activeSets}
                        onAdd={onAdd}
                    />
                ))}
            </div>
            {hasMore && (
                <div
                    ref={sentinelRef}
                    aria-hidden
                    className="h-px w-full shrink-0"
                />
            )}
        </div>
    );
}
