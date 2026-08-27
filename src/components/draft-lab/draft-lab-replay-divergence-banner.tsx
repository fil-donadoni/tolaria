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
import { Banner } from "~/components/ui/banner";

/** v4 (ADR 0103 §3/§5, issue #2730): the shared `Banner` instead of a
 *  bespoke `bg-signal-self/10` / `bg-signal-opponent/10` wash. `signal-self`
 *  / `signal-opponent` name PLAYER identity (ADR 0103 §3 keeps their hues for
 *  exactly that reason) — this banner is not about a player, it is about
 *  replay fidelity, so it borrowed the "self = good, opponent = bad" colour
 *  association rather than using it. `success` / `danger` are the tones that
 *  actually carry "faithful" / "no longer faithful" meaning. */
export default function DraftLabReplayDivergenceBanner({
    result,
}: {
    result: ReplayResult;
}) {
    const total = result.picks.length;

    if (result.firstDivergedPickIndex === null) {
        return (
            <Banner tone="success" className="text-[11px]">
                No divergence — all {total} reconstructed picks match what the
                current scorer would pick. This replay is faithful start to
                finish.
            </Banner>
        );
    }

    const divergedCount = result.picks.filter((p) => p.diverged).length;
    const firstDiverged = result.firstDivergedPickIndex;

    return (
        <Banner tone="danger" className="text-[11px]">
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
        </Banner>
    );
}
