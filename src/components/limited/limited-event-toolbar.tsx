import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { Button } from "@/components/ui/button";
import LimitedStatusBadge from "./limited-status-badge";
import LimitedMatchFormatBadge from "./limited-match-format-badge";

/** One-line meta row under the event title: the way back on the left, the
 *  event's phase on the right.
 *
 *  Replaces two stacked rows (a flourish-wrapped subtitle repeating
 *  `type — packSlots — status`, then a lone back link). The subtitle's content
 *  is now split where it belongs: the format lives in the panel TITLE
 *  (`limitedEventName`), the phase in a chip here — so the header costs one
 *  row instead of three and says more. Seat counts stay out of it on purpose:
 *  the seat roster (or its "Seats · N" disclosure during a draft) sits
 *  directly below and would only repeat them. */
export default function LimitedEventToolbar({
    event,
    onBack,
}: {
    event: LimitedEventView;
    onBack: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <Button variant="link" size="sm" onClick={onBack} className="px-0">
                ← Back to Limited Events
            </Button>
            <span className="flex items-center gap-1.5">
                {/* Match Format (PRD #1628 story 1-2): what kind of event this
                    is, readable before a single pack is opened. */}
                <LimitedMatchFormatBadge event={event} />
                <LimitedStatusBadge event={event} />
            </span>
        </div>
    );
}
