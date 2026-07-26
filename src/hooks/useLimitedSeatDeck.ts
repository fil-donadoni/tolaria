import { useMemo } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import { useUserDecks } from "~/hooks/useUserDecks";

/**
 * The viewer's own deck for one Seat of one Limited Event, or `undefined`
 * while decks are loading / when nothing has been saved for that Seat yet.
 *
 * A Limited deck row arrives with legality already derived server-side
 * (`userDecks.listMine` attaches `isLegal`/`reasons` — the client cannot
 * resolve a Pool on its own), so `deck.isLegal` here is the same verdict the
 * game-start gate will apply. That distinction matters: the EVENT's per-seat
 * `hasDeck` flag is deliberately existence-only (`convex/limited/completion.ts`
 * — "every seat has a deck", not "a legal deck"), so a player who left the
 * builder at 30 cards counts as "deck in" for the table's progress while still
 * being unable to start a match. Every surface that offers to PLAY that deck
 * reads this hook, not `hasDeck`.
 */
export function useLimitedSeatDeck(
    eventId: Id<"limitedEvents">,
    seatIndex: number
): UserLobbyDeck | undefined {
    const decks = useUserDecks();
    return useMemo(
        () =>
            decks?.find(
                (d) =>
                    d.limitedEventId === eventId &&
                    d.limitedSeatId === String(seatIndex)
            ),
        [decks, eventId, seatIndex]
    );
}
