// Shared print-sheet filter+renormalize (ADR 0056/0059). Both the MTGJSON
// importer's ADR-0010 exclusion strip (import time, `mtgjsonImport.ts`) and
// the runtime missing-card drop (ADR 0059, `draftable.ts`'s
// `dropUnimplementedCards`, computed against the live registry at call time)
// remove a set of Scryfall ids from a weighted print sheet and renormalize
// its `totalWeight` — same mechanism, two different id sets to drop, one
// implementation, so "drop + renormalize" is never reinvented per caller.
import type { BoosterSheet } from "./boosterTypes";

export interface FilteredSheet {
    sheet: BoosterSheet;
    /** Scryfall ids removed by `shouldDrop`, in the sheet's original key
     *  order (not sorted — callers that need a stable/sorted list sort it
     *  themselves, since some callers merge this across several sheets). */
    droppedIds: string[];
}

/** Drops every Scryfall id in `sheet.cards` for which `shouldDrop` returns
 *  true and recomputes `totalWeight` from the survivors. Pure — no I/O, no
 *  registry access — the caller owns the predicate (an ADR-0010 exclusion
 *  set, or a live `tryGetDefinition` lookup). A sheet with every card
 *  dropped comes back with an empty `cards` — the caller decides whether
 *  that's an error (the importer does; the runtime dropper doesn't need to,
 *  since the ≥80% Draftability gate already refuses a set that would empty
 *  a sheet out). */
export function dropFromSheet(
    sheet: BoosterSheet,
    shouldDrop: (scryfallId: string) => boolean
): FilteredSheet {
    const cards: Record<string, number> = {};
    let totalWeight = 0;
    const droppedIds: string[] = [];
    for (const [scryfallId, weight] of Object.entries(sheet.cards)) {
        if (shouldDrop(scryfallId)) {
            droppedIds.push(scryfallId);
            continue;
        }
        cards[scryfallId] = weight;
        totalWeight += weight;
    }
    return { sheet: { cards, totalWeight }, droppedIds };
}
