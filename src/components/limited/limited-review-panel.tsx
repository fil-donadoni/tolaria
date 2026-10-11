import { useState } from "react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { Banner } from "@/components/ui/banner";
import { OPEN_DECKLISTS_REVIEW_NOTICE } from "~/lib/openDecklists";
import { seatRecord } from "~/lib/limitedTableRing";
import LimitedReviewSeat from "./limited-review-seat";
import { REVIEW_ZOOM_DEFAULT } from "./limited-review-zoom-slider";

/** "Review the table" — the event page's second tab, from the Play Phase on
 *  (PRD #1107 story 26; issue #5392). One collapsible per seat, the viewer's
 *  first; the viewer's own seat starts open. Whether another seat is locked is
 *  the PROJECTION's verdict — its `pool` is on the wire or it is not
 *  (`areOtherSeatsRevealed`, `convex/limited/eventProjection.ts`, issue
 *  #5386) — never a second client-side copy of the rule. The Open Decklists
 *  banner follows the event's own setting. One zoom value serves every seat. */
export default function LimitedReviewPanel({
    event,
}: {
    event: LimitedEventView;
}) {
    const seats = [...event.seats].sort(
        (a, b) =>
            Number(b.isViewer) - Number(a.isViewer) || a.seatIndex - b.seatIndex
    );
    const [openSeat, setOpenSeat] = useState<number | null>(
        seats.find((s) => s.isViewer)?.seatIndex ?? null
    );
    const [zoom, setZoom] = useState(REVIEW_ZOOM_DEFAULT);
    const finished = event.status === "finished";

    return (
        <div data-slot="review-panel" className="flex flex-col gap-3">
            {event.openDecklists && (
                <Banner tone="info" data-slot="open-decklists-notice">
                    {OPEN_DECKLISTS_REVIEW_NOTICE}
                </Banner>
            )}
            {finished && (
                <p className="text-sm text-text-muted">
                    The event is over — every deck and pick order is public.
                </p>
            )}
            {seats.map((seat) => (
                <LimitedReviewSeat
                    key={seat.seatIndex}
                    seat={seat}
                    eventType={event.type}
                    packCount={event.packSlots.length}
                    record={seatRecord(event, seat.seatIndex)}
                    locked={!seat.isViewer && seat.pool === null}
                    open={openSeat === seat.seatIndex}
                    onToggle={() =>
                        setOpenSeat(
                            openSeat === seat.seatIndex ? null : seat.seatIndex
                        )
                    }
                    zoom={zoom}
                    onZoom={setZoom}
                />
            ))}
        </div>
    );
}
