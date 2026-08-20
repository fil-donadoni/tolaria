import type { Id } from "@convex/_generated/dataModel";
import { arePoolsDealt } from "@convex/limited/eventStatus";
import { useLimitedEvent } from "~/hooks/useLimitedEvent";
import { useUserDecks } from "~/hooks/useUserDecks";
import LoadingScreen from "~/components/ui/loading-screen";
import EmptyState from "~/components/ui/empty-state";
import ErrorState from "~/components/ui/error-state";
import AmbientPageGround from "~/components/ui/ambient-page-ground";
import { Panel } from "~/components/ui/panel";
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

    // TRUE loading: both queries are still in flight (`undefined`).
    if (event === undefined || userDecks === undefined) {
        return <LoadingScreen message="Loading your Pool..." />;
    }

    // A started event (the only way this route is reachable — it needs a
    // dealt Pool) can never be `cancelLimitedEvent`'d (issue #1579's
    // open-status guard), so `null` here only means a stale/bad id — an
    // ERROR (the event this route names is gone), not a loading state that
    // would eventually resolve on its own (issue #2592).
    if (event === null) {
        return (
            <div className="relative flex min-h-full flex-col items-center justify-center bg-surface-base px-4 text-text">
                <AmbientPageGround ring />
                <Panel className="relative z-10 w-full max-w-md">
                    <ErrorState message="This event no longer exists." />
                </Panel>
            </div>
        );
    }

    // EMPTY: the event and the viewer both resolved, but there is nothing to
    // build yet (seat not found, Pool not dealt, or dealt with no cards) —
    // not an error, and not something a loading spinner would ever resolve
    // by itself (issue #2592).
    const viewerSeat = event.seats.find((s) => s.isViewer);
    if (!viewerSeat || !arePoolsDealt(event.status) || !viewerSeat.pool) {
        return (
            <div className="relative flex min-h-full flex-col items-center justify-center bg-surface-base px-4 text-text">
                <AmbientPageGround ring />
                <Panel className="relative z-10 w-full max-w-md">
                    <EmptyState message="No Pool has been generated for your seat yet." />
                </Panel>
            </div>
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
            // seeds the working deck from its Pool Arrangement (the continuous
            // main-by-default rule); a SEALED event has no draft phase, so it
            // falls back to the pre-#1247 "everything starts in the Sideboard"
            // default. `eventType` drives that seed choice.
            eventType={event.type}
            // The LIVE seat Pool Arrangement (issue #1575): the Maindeck⇄
            // Sideboard seed AND the per-card manual column overrides, read
            // reactively so a column drag persisted via setPoolArrangementEntry
            // reflects back and survives reload. Empty for an unarranged seat.
            poolArrangement={viewerSeat.poolArrangement ?? []}
        />
    );
}
