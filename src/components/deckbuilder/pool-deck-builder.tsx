import type { Id } from "@convex/_generated/dataModel";
import { useLimitedEvent } from "~/hooks/useLimitedEvent";
import { useUserDecks } from "~/hooks/useUserDecks";
import LoadingScreen from "~/components/ui/loading-screen";
import PoolDeckBuilderForm from "./pool-deck-builder-form";

/**
 * Pool-scoped deck builder entry point (PRD #1107, ADR 0054/0055, issue
 * #1111): resolves the viewer's own Seat + Pool and any already-saved
 * `limited` deck for it, then hands fully-resolved data to
 * `PoolDeckBuilderForm` — the editor itself only mounts once loading is done,
 * so its working-deck state can be seeded via a plain lazy `useState`
 * initializer (mirrors `DeckBuilder`'s `initialDeck` prop) instead of an
 * effect-driven `setState`.
 */
export default function PoolDeckBuilder({
    eventId,
}: {
    eventId: Id<"limitedEvents">;
}) {
    const event = useLimitedEvent(eventId);
    const userDecks = useUserDecks();

    if (event === undefined || userDecks === undefined) {
        return <LoadingScreen message="Loading your Pool..." />;
    }

    const viewerSeat = event.seats.find((s) => s.isViewer);
    if (!viewerSeat || event.status !== "started" || !viewerSeat.pool) {
        return (
            <LoadingScreen message="No Pool has been generated for your seat yet." />
        );
    }

    const existingDeck =
        userDecks.find(
            (d) =>
                d.limitedEventId === eventId &&
                d.limitedSeatId === String(viewerSeat.seatIndex)
        ) ?? null;

    return (
        <PoolDeckBuilderForm
            eventId={eventId}
            seatIndex={viewerSeat.seatIndex}
            pool={viewerSeat.pool}
            existingDeck={existingDeck}
            // Continuous draft→build (ADR 0060, issue #1247): a DRAFT event
            // seeds the working deck from its Pool Arrangement — an array
            // (even an empty one, for a player who never moved a card) means
            // "resolve every card via the continuous main-by-default rule."
            // `null` (Sealed — no draft phase ever built an Arrangement) is
            // the signal `PoolDeckBuilderForm` uses to fall back to the
            // pre-#1247 "everything starts in the Sideboard" default.
            poolArrangement={
                event.type === "draft" ? (viewerSeat.poolArrangement ?? []) : null
            }
        />
    );
}
