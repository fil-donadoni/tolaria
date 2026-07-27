// Shared seat-label helper for the Draft Lab replay surface (issue #1613
// fixup, pre-merge review non-blocking finding 3). Extracted out of
// `draft-lab-replay-pick-list.tsx` so `draft-lab-replay-stop-notice.tsx` uses
// the EXACT same "nickname, else 1-based Seat N" label instead of printing a
// raw 0-based `seatIndex` — the two surfaces disagreeing on how they number
// seats (one nickname/1-based, the other a bare 0-based index) read as two
// different seats to a viewer paging between them.
import type { LimitedEventSeatView } from "@/hooks/useLimitedEvent";

export function seatLabelFor(
    seats: readonly LimitedEventSeatView[],
    seatIndex: number
): string {
    const seat = seats.find((s) => s.seatIndex === seatIndex);
    return seat?.nickname ?? `Seat ${seatIndex + 1}`;
}
