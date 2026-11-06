import { useMemo } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { toArchivedLobbyDeck, type UserLobbyDeck } from "~/lib/deckTypes";

const PAGE_SIZE = 25;

/** Other players' Limited decks for the Match setup (issue #8411), a page at a
 *  time: the server caps a page because legality costs reads per deck.
 *  `enabled: false` subscribes to nothing. */
export function useArchivedLobbyDecks(enabled: boolean): {
    decks: UserLobbyDeck[];
    /** Absent when there is nothing more to fetch. */
    loadMore?: () => void;
} {
    const { results, status, loadMore } = usePaginatedQuery(
        api.userDecks.listSeatableLimitedDecksAdmin,
        enabled ? {} : "skip",
        { initialNumItems: PAGE_SIZE }
    );
    const decks = useMemo(() => results.map(toArchivedLobbyDeck), [results]);
    return {
        decks,
        loadMore:
            status === "CanLoadMore" ? () => loadMore(PAGE_SIZE) : undefined,
    };
}
