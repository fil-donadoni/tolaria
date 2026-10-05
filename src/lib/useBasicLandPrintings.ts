import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardPrinting } from "@convex/cards/catalogue";
import {
    basicLandDefinitionId,
    legalBasicLandPrintings,
    type BasicLandSubtype,
} from "~/components/deckbuilder/basicLands";

// A basic land has ~1,000 printings: the art grid reads them a page at a time
// (PRD #4115 § cost), the Format's allowed-Sets filter applied inside the query.
const PAGE_SIZE = 60;

/**
 * The art picker's printings of one Basic subtype (issue #5106), read from
 * `cardPrints` only while the popover is `open` — never eagerly for five
 * subtypes. `loadMore` pulls the next page; `canLoadMore` is false once the
 * query is done.
 */
export function useBasicLandPrintings(
    subtype: BasicLandSubtype,
    allowedSets: string[] | null,
    open: boolean
): { printings: CardPrinting[]; canLoadMore: boolean; loadMore: () => void } {
    const cardId = basicLandDefinitionId(subtype);
    const { results, status, loadMore } = usePaginatedQuery(
        api.cardPrints.listByCardId,
        open && cardId !== null
            ? { cardId, allowedSets: allowedSets ?? undefined }
            : "skip",
        { initialNumItems: PAGE_SIZE }
    );
    return {
        printings: legalBasicLandPrintings(subtype, results, allowedSets),
        canLoadMore: status === "CanLoadMore",
        loadMore: () => loadMore(PAGE_SIZE),
    };
}
