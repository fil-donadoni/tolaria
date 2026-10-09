import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { PickerPrinting } from "./printingPicker";

// A basic land has ~1,000 printings: the picker reads them a page at a time
// (PRD #4115 § cost), the Set restriction applied inside the query.
const PAGE_SIZE = 60;

/**
 * Every `cardPrints` (ADR 0140) row for one Card ID, read only while the
 * printing picker is `open` (issue #4122) — never eagerly for a whole
 * search-result page. `sets` restricts the query to those Sets: the Format's
 * allowed Sets (Old School / Alpha 40) intersected with the picker's text
 * filter, so "odyssey" finds a basic land's four ODY printings without paging
 * through the other thousand. `null` = every Set; an empty list matches
 * nothing and skips the read.
 */
export function useCardPrintings(
    cardId: string | null,
    sets: string[] | null,
    open: boolean
): {
    printings: PickerPrinting[];
    loading: boolean;
    canLoadMore: boolean;
    loadMore: () => void;
} {
    const skip =
        !open || cardId === null || (sets !== null && sets.length === 0);
    const { results, status, loadMore } = usePaginatedQuery(
        api.cardPrints.listByCardId,
        skip || cardId === null
            ? "skip"
            : { cardId, allowedSets: sets ?? undefined },
        { initialNumItems: PAGE_SIZE }
    );
    return {
        printings: results.map((row) => ({
            printId: row.printId,
            setCode: row.set,
            promo: row.promo,
            digital: row.digital,
        })),
        loading:
            !skip &&
            (status === "LoadingFirstPage" || status === "LoadingMore"),
        canLoadMore: status === "CanLoadMore",
        loadMore: () => loadMore(PAGE_SIZE),
    };
}
