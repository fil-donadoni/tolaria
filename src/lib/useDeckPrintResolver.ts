import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { type ResolveCard, resolveCardViaDefinitionIds } from "@convex/formats";
import { resolveDeckCardMeta } from "@convex/cards/catalogue";
import {
    indexPrintRows,
    makeResolveCardFromRows,
} from "@convex/cards/printRows";

interface DeckEntry {
    cardId: string;
    definitionId?: string;
}

/** Whether an entry names a printing other than its Card Definition's own —
 *  one with a `cardPrints` row to fetch. A `definitionId` says so outright; an
 *  entry without one (a Limited Basic re-arted by the art picker, issue
 *  #5550) says so by being an id the registry does not know. */
function namesAPrinting(entry: DeckEntry): boolean {
    return entry.definitionId !== undefined
        ? entry.cardId !== entry.definitionId
        : resolveDeckCardMeta(entry.cardId) === null;
}

/**
 * The deck builder's `ResolveCard` (Card Prints, ADR 0140, issue #4118): built
 * from the `cardPrints` rows of the printings the working deck names, the
 * same resolver the server's game-start gate builds from the same table. Only
 * entries whose chosen printing differs from their Card Definition have a row
 * to fetch; until the query resolves (or for an unsynced printing) an id
 * resolves through its entry's `definitionId` (`resolveCardViaDefinitionIds`),
 * so a reprinted Basic never reads as off-Pool while the rows load.
 */
export function useDeckPrintResolver(
    entries: readonly DeckEntry[]
): ResolveCard {
    // Keyed on CONTENT, so a caller that spreads its zones into a fresh array
    // every render still gets a stable resolver (and a stable legality memo).
    const entriesKey = entries
        .map((e) => `${e.cardId}:${e.definitionId ?? ""}`)
        .join(",");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content
    const stableEntries = useMemo(() => entries, [entriesKey]);
    const printIds = useMemo(
        () => [
            ...new Set(
                stableEntries.filter(namesAPrinting).map((e) => e.cardId)
            ),
        ],
        [stableEntries]
    );
    const rows = useQuery(
        api.cardPrints.getByPrintIds,
        printIds.length > 0 ? { printIds } : "skip"
    );
    // Keep the last loaded rows while a changed id set re-queries, so the
    // verdict does not flash back to the fallback on every printing change.
    const [lastRows, setLastRows] = useState(rows);
    if (rows !== undefined && rows !== lastRows) setLastRows(rows);
    const shown = rows ?? lastRows;
    return useMemo(
        () =>
            makeResolveCardFromRows(
                indexPrintRows(shown ?? []),
                resolveCardViaDefinitionIds(stableEntries)
            ),
        [shown, stableEntries]
    );
}
