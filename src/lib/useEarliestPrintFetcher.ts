import { useCallback } from "react";
import { useConvex } from "convex/react";
import { api } from "@convex/_generated/api";
import type { EarliestPrintRows } from "~/lib/deckImport";

// Matches the server's per-call cap (`cardPrints.earliestInSets`): a decklist
// is split into calls of this many Card IDs.
const CHUNK = 40;

/**
 * One-shot fetch of the earliest `cardPrints` row per Card ID inside a
 * Format's allowed Sets (issue #5106) — what `parseDecklist` needs to choose
 * a legal printing. A function, not a subscription: the decklist import asks
 * once per Parse click, never reactively.
 */
export function useEarliestPrintFetcher(): (
    cardIds: readonly string[],
    allowedSets: readonly string[]
) => Promise<EarliestPrintRows> {
    const convex = useConvex();
    return useCallback(
        async (cardIds, allowedSets) => {
            const ids = [...new Set(cardIds)];
            const chunks: string[][] = [];
            for (let i = 0; i < ids.length; i += CHUNK) {
                chunks.push(ids.slice(i, i + CHUNK));
            }
            const pages = await Promise.all(
                chunks.map((chunk) =>
                    convex.query(api.cardPrints.earliestInSets, {
                        cardIds: chunk,
                        allowedSets: [...allowedSets],
                    })
                )
            );
            return new Map(
                pages
                    .flat()
                    .map((r) => [r.cardId, { printId: r.printId, set: r.set }])
            );
        },
        [convex]
    );
}
