import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { limitedEventStatusHint } from "~/lib/limitedEventStatus";

/** The event's PHASE as a compact chip — open / drafting / deckbuilding /
 *  ready to play (`limitedEventStatusHint`, issue #1582). Preferred over the
 *  raw `status` enum anywhere the phase is shown to a player: "started" is a
 *  DB state, "drafting" is what the player is actually doing. Extracted from
 *  the lobby's Limited box so the dashboard row and the event header render
 *  the identical chip. */
export default function LimitedStatusBadge({
    event,
}: {
    event: Pick<
        LimitedEventView,
        "status" | "type" | "draftCompletedAt" | "completed"
    >;
}) {
    return (
        <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
            {limitedEventStatusHint(event)}
        </span>
    );
}
