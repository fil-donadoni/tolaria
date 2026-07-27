// Explains why reconstruction stopped short of the draft's natural end
// (issue #1613) — never a silent partial result. `ReplayStopReason` names
// exactly two cases (`reconstructDraftReplay`'s doc comment):
//   - "hidden-pool": this viewer can't see the acting seat's Pool (the same
//     admin-gated privacy `eventProjection.ts` already enforces).
//   - "pool-mismatch": a stored Pool entry doesn't match any card in the
//     regenerated pack — the seed/pack source no longer reproduces the SAME
//     packs this event was really drafted from.
//
// Seat label (issue #1613 fixup, non-blocking finding 3): uses the SAME
// `seatLabelFor` (nickname, else 1-based "Seat N") that
// `draft-lab-replay-pick-list.tsx` labels seats with — this used to print
// the raw 0-based `seatIndex` instead, so the same seat read as two
// different seats depending on which part of the panel you looked at.
import type {
    ReplayResult,
    ReplayStopReason,
} from "@/lib/limited/draftReplayEngine";
import type { LimitedEventSeatView } from "@/hooks/useLimitedEvent";
import { seatLabelFor } from "@/lib/limited/replaySeatLabel";

const STOP_REASON_MESSAGE: Record<ReplayStopReason, string> = {
    "hidden-pool":
        "Reconstruction stopped here because this viewer can't see this seat's stored Pool — the same privacy rule that hides another seat's Pool during and after a live event. Full reconstruction needs every seat's Pool visible (an admin viewing their own table has this).",
    "pool-mismatch":
        "Reconstruction stopped here because this seat's stored Pool entry doesn't match any card in the regenerated pack. This means the seed or Pack Source can no longer reproduce the packs this event was really drafted from (e.g. the Draftable Set's card list changed) — the reconstruction is unreliable from this point, not just unfaithful.",
};

export default function DraftLabReplayStopNotice({
    result,
    seats,
}: {
    result: ReplayResult;
    seats: readonly LimitedEventSeatView[];
}) {
    if (result.complete || !result.stopReason) return null;

    return (
        <p className="rounded-sm bg-signal-opponent/15 px-2 py-1.5 text-[11px] text-signal-opponent">
            Stopped at {seatLabelFor(seats, result.stoppedAtSeat!)} —{" "}
            {STOP_REASON_MESSAGE[result.stopReason]}
        </p>
    );
}
