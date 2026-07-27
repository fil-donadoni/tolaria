// Every reconstructed pick, historical fact beside recomputed (issue #1613:
// "see which of the 360 picks moved"). Renders ALL picks unconditionally —
// nothing past the divergence point is hidden, only visually de-emphasised
// (`DraftLabReplayPickRow`'s `pastDivergence`), per ADR 0074's "a replay tool
// that quietly keeps rendering after it has stopped describing reality is
// actively misleading": the fix is never to stop rendering, only to say so.
import type { ReplayResult } from "@/lib/limited/draftReplayEngine";
import type { LimitedEventSeatView } from "@/hooks/useLimitedEvent";
import DraftLabReplayPickRow from "./draft-lab-replay-pick-row";

function seatLabelFor(
    seats: readonly LimitedEventSeatView[],
    seatIndex: number
): string {
    const seat = seats.find((s) => s.seatIndex === seatIndex);
    return seat?.nickname ?? `Seat ${seatIndex + 1}`;
}

export default function DraftLabReplayPickList({
    result,
    seats,
}: {
    result: ReplayResult;
    seats: readonly LimitedEventSeatView[];
}) {
    const firstDiverged = result.firstDivergedPickIndex;

    return (
        <div className="flex flex-col gap-1">
            <div className="grid grid-cols-[2.5rem_5rem_1fr_1fr] gap-2 px-1.5 text-[10px] tracking-wide text-text-disabled uppercase">
                <span>Pick</span>
                <span>Seat</span>
                <span>Historical</span>
                <span>Recomputed</span>
            </div>
            <ul className="flex max-h-[28rem] flex-col gap-0.5 overflow-y-auto">
                {result.picks.map((entry) => (
                    <DraftLabReplayPickRow
                        key={entry.pickIndex}
                        entry={entry}
                        seatLabel={seatLabelFor(seats, entry.seatIndex)}
                        pastDivergence={
                            firstDiverged !== null &&
                            entry.pickIndex >= firstDiverged
                        }
                    />
                ))}
            </ul>
        </div>
    );
}
