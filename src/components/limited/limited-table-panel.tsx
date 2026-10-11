import { useState } from "react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { Button } from "@/components/ui/button";
import LimitedTableAvatarRow from "./limited-table-avatar-row";
import { tableSummaryLine } from "~/lib/limitedTableRing";
import LimitedTableRing from "./limited-table-ring";
import LimitedTableRingView from "./limited-table-ring-view";

/** The table (issue #5390, replacing the seats disclosure + "View Table"-only
 *  avatar row of issue #2590): from `md` up the ring of seats sits inline in
 *  its tile; below it a compact tile — avatar row + one-line summary — opens
 *  the same ring in a dialog (`LimitedTableRing`, ADR 0101 §6). Both arms are
 *  always in the DOM and swapped by CSS (`hidden md:block` / `md:hidden`), so
 *  there is no viewport hook and no flash on resize; the dialog body mounts
 *  only while open.
 *
 *  `round` is the booster round (`draftRound`): the pass arrows only draw
 *  while drafting (`ringPhaseFacts`), which is when it decides the direction.
 *
 *  `showProgress` mirrors `LimitedEventDetail`'s `isPoolFinal` (issue #1580):
 *  a deck cannot exist before the Pool is final, so before that point the
 *  counter would always read 0 and misread as live progress. */
export default function LimitedTablePanel({
    event,
    showProgress,
}: {
    event: LimitedEventView;
    showProgress: boolean;
}) {
    const [ringOpen, setRingOpen] = useState(false);
    const round = event.draftRound ?? 0;
    const pct =
        event.seatCount > 0
            ? Math.round((event.seatsWithDeck / event.seatCount) * 100)
            : 0;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    The table
                </h3>
                {showProgress && (
                    <span className="text-xs text-text-muted">
                        {event.completed
                            ? "Every seat has a deck"
                            : `${event.seatsWithDeck}/${event.seatCount} decks in`}
                    </span>
                )}
            </div>

            {showProgress && (
                <div
                    className="h-1 w-full overflow-hidden rounded-full bg-surface-elevated"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={event.seatCount}
                    aria-valuenow={event.seatsWithDeck}
                    aria-label="Decks submitted"
                >
                    <div
                        className="h-full bg-success transition-[width]"
                        style={{ width: `${pct}%` }}
                    />
                </div>
            )}

            <div data-slot="table-inline" className="hidden md:block">
                <LimitedTableRingView event={event} round={round} />
            </div>

            <div
                data-slot="table-tile"
                className="flex items-center justify-between gap-3 md:hidden"
            >
                <div className="flex min-w-0 flex-col gap-1.5">
                    <LimitedTableAvatarRow seats={event.seats} />
                    <span className="text-xs text-text-muted">
                        {tableSummaryLine(event.seats)}
                    </span>
                </div>
                <Button
                    type="button"
                    variant="secondary"
                    size="xs"
                    onClick={() => setRingOpen(true)}
                >
                    View Table
                </Button>
            </div>

            <LimitedTableRing
                open={ringOpen}
                onOpenChange={setRingOpen}
                event={event}
                round={round}
            />
        </div>
    );
}
