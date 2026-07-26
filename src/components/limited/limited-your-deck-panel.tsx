import { useNavigate } from "@tanstack/react-router";
import type { Id } from "@convex/_generated/dataModel";
import { useLimitedSeatDeck } from "~/hooks/useLimitedSeatDeck";
import { cn } from "~/lib/utils";
import ActionButton from "~/components/board/action-button";

/** The viewer's own deck for this Seat, and the way into the builder — shown
 *  for EVERY state once the Pool is final, never hidden.
 *
 *  Hiding it once a deck row existed is what stranded a player who left the
 *  builder below the 40-card minimum: the event's `hasDeck` flag is
 *  existence-only (`convex/limited/completion.ts`), so the seat counted as
 *  "deck in" while the deck could not legally start a match — and with no
 *  builder entry point left on the page, there was no way to finish it. The
 *  three states, all with the same Edit/Build affordance:
 *
 *  - no deck yet → the Pool is ready, go build;
 *  - deck present but ILLEGAL → why, plus the way back in;
 *  - deck present and legal → card count, ready to play. */
export default function LimitedYourDeckPanel({
    eventId,
    seatIndex,
    poolCount,
}: {
    eventId: Id<"limitedEvents">;
    seatIndex: number;
    poolCount: number | null;
}) {
    const navigate = useNavigate();
    const deck = useLimitedSeatDeck(eventId, seatIndex);
    const openBuilder = () =>
        void navigate({
            to: "/limited/$eventId/build",
            params: { eventId },
        });

    const illegal = deck !== undefined && !deck.isLegal;

    return (
        <div
            className={cn(
                "flex flex-wrap items-center justify-between gap-3 rounded-sm border px-4 py-3",
                illegal
                    ? "border-danger/50 bg-danger/5"
                    : "border-accent/40 bg-accent/5"
            )}
        >
            <div className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold text-text">
                    {deck === undefined
                        ? "Your Pool is ready"
                        : illegal
                          ? "Your deck isn't ready to play"
                          : `Your deck · ${deck.cards.length} cards`}
                </span>
                <span className="text-xs text-text-muted">
                    {deck === undefined
                        ? poolCount === null
                            ? "Build your deck to join the matches."
                            : `${poolCount} cards to build from — 40-card minimum.`
                        : illegal
                          ? (deck.reasons[0]?.message ??
                            "It doesn't meet the Limited deck rules yet.")
                          : "Legal for Limited — challenge a seat or play the bots."}
                </span>
            </div>
            <ActionButton
                onClick={openBuilder}
                label={deck === undefined ? "Build Deck" : "Edit Deck"}
                tone="primary"
            />
        </div>
    );
}
