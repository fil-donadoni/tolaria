import { useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import {
    useLimitedEventMutations,
    type LimitedEventSeatView,
} from "~/hooks/useLimitedEvent";
import CardZoomSlider from "~/components/lobby/deck-builder/card-zoom-slider";
import { useCardZoom } from "~/components/lobby/deck-builder/useCardZoom";
import LimitedDraftPack from "./limited-draft-pack";
import LimitedDraftTimer from "./limited-draft-timer";
import LimitedDraftPool from "./limited-draft-pool";

/** The Draft table (PRD #1107 stories 10-13, issue #1112): the Booster in
 *  front of the viewer with a Pick button per card, how many packs are
 *  queued behind it, and the viewer's accumulated Pool so far. Picking calls
 *  `submitPick` — the server re-derives the seat from the caller's identity
 *  and validates the picked card is actually in that seat's current pack, so
 *  this component never has to (and never sends) a seat id. */
export default function LimitedDraftTable({
    eventId,
    seat,
    round,
    totalRounds,
}: {
    eventId: Id<"limitedEvents">;
    seat: LimitedEventSeatView;
    round: number;
    totalRounds: number;
}) {
    const { submitPick } = useLimitedEventMutations();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Booster zoom slider (ADR 0060, issue #1247, PRD #1107 story 21) —
    // mirrors the deckbuilder's per-zone `useCardZoom`/`CardZoomSlider`
    // wiring, its own "booster" zone so it persists independently of the
    // Pool surface's own zoom.
    const boosterZoom = useCardZoom({
        zone: "limited-booster",
        min: 1,
        max: 2.2,
        initial: 1.2,
    });

    const handlePick = async (pickId: string) => {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            await submitPick({ eventId, pickId });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Something went wrong."
            );
        } finally {
            setPending(false);
        }
    };

    const pack = seat.currentPack ?? [];
    const queueCount = seat.packQueueCount ?? 0;
    const pool = seat.pool ?? [];

    return (
        <div className="mt-4 flex flex-col gap-3 border-t border-border-accent/20 pt-4">
            <div className="flex items-center justify-between text-xs text-text-muted">
                <span>
                    Booster {round + 1} of {totalRounds}
                </span>
                <div className="flex items-center gap-2">
                    <CardZoomSlider
                        value={boosterZoom.value}
                        min={boosterZoom.min}
                        max={boosterZoom.max}
                        onChange={boosterZoom.set}
                        label="Booster card size"
                    />
                    <LimitedDraftTimer pickDeadline={seat.pickDeadline} />
                    <span>
                        {queueCount > 0
                            ? `${queueCount} pack${queueCount === 1 ? "" : "s"} queued`
                            : "No packs queued"}
                    </span>
                </div>
            </div>

            {error && (
                <div className="rounded-sm border border-danger/50 bg-danger/10 px-4 py-3 text-sm text-danger">
                    {error}
                </div>
            )}

            <LimitedDraftPack
                pack={pack}
                onPick={handlePick}
                pending={pending}
                zoom={boosterZoom.value}
            />

            <div className="border-t border-border-accent/20 pt-3">
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
                    Your Pool ({pool.length})
                </h3>
                <LimitedDraftPool
                    eventId={eventId}
                    pool={pool}
                    arrangement={seat.poolArrangement}
                />
            </div>
        </div>
    );
}
