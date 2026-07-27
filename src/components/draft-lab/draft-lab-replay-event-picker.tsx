// Picks which completed Draft event to reconstruct (issue #1613). Only
// `completed` Draft events are offered — a running event's `seed` isn't on
// the wire yet (`eventProjection.ts`), and Sealed events have no picks to
// replay.
import type { LimitedEventSummaryView } from "@/hooks/useLimitedEvent";

export default function DraftLabReplayEventPicker({
    events,
    selectedEventId,
    onSelect,
}: {
    events: LimitedEventSummaryView[] | undefined;
    selectedEventId: string | null;
    onSelect: (eventId: string | null) => void;
}) {
    if (events === undefined) {
        return (
            <p className="text-[11px] text-text-disabled">
                Loading your completed Draft events…
            </p>
        );
    }

    if (events.length === 0) {
        return (
            <p className="text-[11px] text-text-disabled">
                No completed Draft events yet — play one through to a full Deck
                on every seat, then come back here to replay it.
            </p>
        );
    }

    return (
        <label className="flex flex-col gap-1 text-[11px] text-text-muted">
            Completed Draft event
            <select
                className="rounded-sm border border-border-subtle bg-surface-elevated/60 px-2 py-1 text-xs text-text"
                value={selectedEventId ?? ""}
                onChange={(e) => onSelect(e.target.value || null)}
            >
                <option value="">Select an event…</option>
                {events.map((event) => (
                    <option key={event._id} value={event._id}>
                        {event.packSlots.join(", ")} — {event.seatCount} seats —{" "}
                        {new Date(event.createdAt).toLocaleString()}
                    </option>
                ))}
            </select>
        </label>
    );
}
