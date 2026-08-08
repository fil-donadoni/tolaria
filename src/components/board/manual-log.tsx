import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ManualLogEntry } from "@convex/manual";
import { useFullCatalogue } from "~/lib/fullCatalogue";
import {
    makeCatalogueRowLookup,
    type CatalogueRowLookup,
} from "~/lib/manual-band";

/** Matches a `{{card:N}}` placeholder `ManualLogEntry.text` embeds for the
 *  Nth entry of `entry.cards` (`convex/manual.ts`). */
const CARD_REF_PATTERN = /\{\{card:(\d+)\}\}/g;

/**
 * Renders a `ManualLogEntry`'s display text, substituting every
 * `{{card:N}}` placeholder with the resolved name for `entry.cards[N]` (a
 * Full Catalogue print id) — the server never hydrates a `CardDefinition`
 * for a manual card (ADR 0080's fourth invariant), so name resolution is
 * entirely client-side.
 *
 * - A print id the catalogue can't resolve renders as the raw id: never
 *   blank, never a crash (matches the pre-#2350 behaviour for that one
 *   card, even once every OTHER card in the same entry resolves fine).
 * - An entry with no `cards` (every entry written before #2350) has no
 *   placeholders in `text` either, so it renders exactly as before —
 *   id-only. No backfill.
 */
function resolveManualLogText(
    entry: ManualLogEntry,
    lookupRow: CatalogueRowLookup
): string {
    const cards = entry.cards;
    if (!cards || cards.length === 0) return entry.text;
    return entry.text.replace(CARD_REF_PATTERN, (match, indexStr: string) => {
        const printId = cards[Number(indexStr)];
        if (printId === undefined) return match;
        return lookupRow(printId)?.name ?? printId;
    });
}

export default function ManualLog({ gameId }: { gameId: Id<"games"> }) {
    const containerRef = useRef<HTMLDivElement>(null);
    const shouldScrollRef = useRef(true);
    const { results, status, loadMore } = usePaginatedQuery(
        api.manualLog.getManualLog,
        { gameId },
        { initialNumItems: 50 }
    );
    const { rows } = useFullCatalogue();
    const lookupRow = useMemo(() => makeCatalogueRowLookup(rows), [rows]);

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
                        {resolveManualLogText(entry, lookupRow)}
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
