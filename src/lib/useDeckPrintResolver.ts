import { useMemo, useRef } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ResolveCard } from "@convex/formats";
import {
    indexPrintRows,
    makeResolveCardFromRows,
} from "@convex/cards/printRows";

interface DeckEntry {
    cardId: string;
    definitionId?: string;
}

/**
 * The deck builder's `ResolveCard` (Card Prints, ADR 0140, issue #4118): built
 * from the `cardPrints` rows of the printings the working deck names, the
 * same resolver the server's game-start gate builds from the same table. Only
 * entries whose chosen printing differs from their Card Definition have a row
 * to fetch; until the query resolves (or for an unsynced printing) the
 * resolver falls back exactly like the server's.
 */
export function useDeckPrintResolver(
    entries: readonly DeckEntry[]
): ResolveCard {
    const printIds = useMemo(
        () => [
            ...new Set(
                entries
                    .filter((e) => e.cardId !== (e.definitionId ?? e.cardId))
                    .map((e) => e.cardId)
            ),
        ],
        [entries]
    );
    const rows = useQuery(
        api.cardPrints.getByPrintIds,
        printIds.length > 0 ? { printIds } : "skip"
    );
    // Keep the last loaded rows while a changed id set re-queries, so the
    // verdict does not flash back to the fallback on every printing change.
    const lastRows = useRef(rows);
    if (rows !== undefined) lastRows.current = rows;
    const shown = rows ?? lastRows.current;
    return useMemo(
        () => makeResolveCardFromRows(indexPrintRows(shown ?? [])),
        [shown]
    );
}
