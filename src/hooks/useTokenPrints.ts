import { createContext, useContext, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
    EMPTY_TOKEN_PRINT_INDEX,
    indexTokenPrintRows,
    type TokenPrintIndex,
} from "~/lib/tokenArt";

/** The Game's Token Print rows, indexed by Print ID (ADR 0140 §4, issue
 *  #4120). Empty outside a board (design system, tests), where a token simply
 *  has no edition art to resolve. */
export const TokenPrintsContext = createContext<TokenPrintIndex>(
    EMPTY_TOKEN_PRINT_INDEX
);

export function useTokenPrints(): TokenPrintIndex {
    return useContext(TokenPrintsContext);
}

/**
 * The one Game-load Token Print query: every Print ID in both decks
 * (`gameArtCardIds`) in a single subscription, so a token's art is resolved
 * from rows already in hand and never from a per-token fetch. Rows are static
 * for a game's lifetime; the last loaded set is kept across a re-query so art
 * never flickers back to the placeholder.
 */
export function useTokenPrintsState(
    printIds: readonly string[] | undefined
): TokenPrintIndex {
    const rows = useQuery(
        api.cardPrints.tokenPrintsForGame,
        printIds && printIds.length > 0 ? { printIds: [...printIds] } : "skip"
    );
    const [lastRows, setLastRows] = useState(rows);
    if (rows !== undefined && rows !== lastRows) setLastRows(rows);
    const shown = rows ?? lastRows;
    return useMemo(
        () => (shown ? indexTokenPrintRows(shown) : EMPTY_TOKEN_PRINT_INDEX),
        [shown]
    );
}
