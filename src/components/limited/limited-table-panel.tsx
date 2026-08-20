import { useState } from "react";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { Button } from "@/components/ui/button";
import LimitedTableAvatarRow from "./limited-table-avatar-row";
import LimitedTableRing from "./limited-table-ring";

/** The table at a glance: who is sitting where, and how far the table is
 *  through deck building — a compact avatar row, never the full seat grid
 *  (issue #2590; ADR 0101's "an Arena-style dialog, never a dominant page
 *  element" for the Ring applies to the whole roster now, not just the
 *  Draft Room). The full per-seat detail (`LimitedTableRing`, ADR 0101 §6,
 *  issue #2587) opens as a dialog via "View Table" — it already existed and
 *  was only ever mounted from the Draft Room; this wires it into the
 *  antechamber too, unchanged.
 *
 *  `round` is passed as `event.currentRound ?? 0`: the Ring's "packs passing"
 *  subtitle is meaningful mid-draft (its original context) and reads as inert
 *  copy for a Sealed/finished event here — a wiring choice, not a rewrite of
 *  the Ring's content (see the PR description / `docs/findings/` for the
 *  follow-up note).
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
    const pct =
        event.seatCount > 0
            ? Math.round((event.seatsWithDeck / event.seatCount) * 100)
            : 0;

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Table
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

            <div className="flex items-center justify-between gap-3">
                <LimitedTableAvatarRow seats={event.seats} />
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
                round={event.currentRound ?? 0}
            />
        </div>
    );
}
