import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { CardPrinting } from "@convex/cards/catalogue";

// One page is enough for the deck builder's dropdown: it shows the whole
// list, never paginates further (the visual picker in issue #4122 is where
// "load more" would belong). A basic land runs on the order of a thousand
// printings, well past this page — the dropdown then shows the first 500,
// which is still far more choice than the hand-written catalogue ever
// offered and avoids a `.collect()`-sized read for every open.
const PAGE_SIZE = 500;

/**
 * Lazily loads every `cardPrints` (ADR 0140) row for one Card ID, queried
 * only once `load()` is called (the deck builder's edition dropdown calls it
 * from `onOpen`, issue #4117) — never eagerly for a whole search-result page.
 * `allowedSets`, when given (Old School / Alpha 40), is applied INSIDE the
 * query (`cardPrints.listByCardId`) so those Formats' selectors never pull
 * down a set they could not legally offer.
 */
export function useCardPrintEditions(
    cardId: string,
    allowedSets: string[] | null
): { prints: CardPrinting[] | undefined; load: () => void } {
    const [opened, setOpened] = useState(false);
    const result = useQuery(
        api.cardPrints.listByCardId,
        opened
            ? {
                  cardId,
                  allowedSets: allowedSets ?? undefined,
                  paginationOpts: { numItems: PAGE_SIZE, cursor: null },
              }
            : "skip"
    );
    const prints = result?.page.map((row) => ({
        printId: row.printId,
        setCode: row.set,
    }));
    return { prints, load: () => setOpened(true) };
}
