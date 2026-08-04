import { useCallback, useEffect, useRef } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ManualLogEntry } from "@convex/manual";

export default function ManualLog({ gameId }: { gameId: Id<"games"> }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const shouldScrollRef = useRef(true);
    const { results, status, loadMore } = usePaginatedQuery(
        api.manualLog.getManualLog,
        { gameId },
        { initialNumItems: 50 }
    );

    const handleLoadMore = useCallback(
        (num: number) => {
            shouldScrollRef.current = false;
            loadMore(num);
        },
        [loadMore]
    );

    useEffect(() => {
        if (shouldScrollRef.current && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
        shouldScrollRef.current = true;
    }, [results.length]);

    const reversed = [...results]
        .map((r) => r.action as ManualLogEntry)
        .reverse();

    return (
        <div className="flex flex-col border-l border-white/10 bg-black/40 w-80 shrink-0">
            <div className="px-3 py-2 text-xs font-semibold text-white/50 uppercase tracking-wide border-b border-white/10">
                Action Log
            </div>
            <div
                ref={containerRef}
                className="flex-1 overflow-y-auto px-3 py-2"
            >
                {status === "LoadingFirstPage" && (
                    <div className="text-xs text-white/30">Loading...</div>
                )}
                {status === "CanLoadMore" && (
                    <button
                        onClick={() => handleLoadMore(20)}
                        className="text-xs text-white/40 hover:text-white/70 mb-1 underline"
                    >
                        Load earlier
                    </button>
                )}
                {reversed.map((entry, i) => (
                    <div
                        key={i}
                        className="text-xs text-white/70 py-0.5 font-mono leading-relaxed"
                    >
                        {entry.text}
                    </div>
                ))}
                {reversed.length === 0 && status !== "LoadingFirstPage" && (
                    <div className="text-xs text-white/30 italic">
                        No actions yet
                    </div>
                )}
            </div>
        </div>
    );
}
