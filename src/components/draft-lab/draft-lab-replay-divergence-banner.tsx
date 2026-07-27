// The divergence marker (issue #1613, ADR 0074 — this slice's sharpest
// requirement). The moment a retuned scorer changes a bot pick, the packs
// passed onward are no longer the packs that were really passed — a replay
// tool that quietly keeps rendering past that point without saying so is
// actively misleading. This banner is the ONE place that says so, always
// visible whenever a reconstruction ran (never silently omitted).
//
// Off-by-one fix (issue #1613 fixup, non-blocking finding 3): `pickIndex` is
// 1-based, so "faithful through pick N-1" is correct arithmetic for N > 1,
// but reads as "faithful through pick 0" when the very FIRST pick already
// diverged (N === 1) — a human-facing miscount, since pick 0 doesn't exist.
// The `firstDivergedPickIndex > 1` branch below states the no-faithful-picks
// case in words instead.
import type { ReplayResult } from "@/lib/limited/draftReplayEngine";

export default function DraftLabReplayDivergenceBanner({
    result,
}: {
    result: ReplayResult;
}) {
    const total = result.picks.length;

    if (result.firstDivergedPickIndex === null) {
        return (
            <p className="rounded-sm bg-signal-self/10 px-2 py-1.5 text-[11px] text-signal-self">
                No divergence — all {total} reconstructed picks match what the
                current scorer would pick. This replay is faithful start to
                finish.
            </p>
        );
    }

    const divergedCount = result.picks.filter((p) => p.diverged).length;
    const firstDiverged = result.firstDivergedPickIndex;

    return (
        <p className="rounded-sm bg-signal-opponent/10 px-2 py-1.5 text-[11px] text-signal-opponent">
            {firstDiverged > 1 ? (
                <>
                    Faithful through pick {firstDiverged - 1} of {total}.{" "}
                </>
            ) : (
                <>
                    No pick was faithful — it diverged from the very first
                    one.{" "}
                </>
            )}
            From pick {firstDiverged} on, the current scorer would have picked
            differently ({divergedCount} of {total} pick(s) moved) — every later
            pick shown below is still computed against the REAL historical
            packs, which a fully retuned redraft would not actually have seen
            past this point, so treat everything from here on as illustrative,
            not a faithful reconstruction.
        </p>
    );
}
