// Mount point for the Verdict Proposal capture of a vs-Bot or a solo game:
// records the human seat's decisions during
// play — both seats in solo — and samples them for the Brain at game end.
// Renders the play-time notes (Plan, comment, "obvious") for the seat on
// screen. Runs for an account that may give a Verdict only (issue #10229):
// no one else is offered the review it feeds.

import type { Id } from "@convex/_generated/dataModel";
import { useVerdictProposalCapture } from "~/hooks/useVerdictProposalCapture";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canSubmitVerdicts } from "~/lib/adminGating";
import DecisionCaptureNotes from "./decision-capture-notes";

export default function VerdictProposalCapture({
    gameId,
    seatIds,
    viewerId,
    seq,
}: {
    gameId: Id<"games">;
    /** The captured seats: a vs-Bot game's human seat (the viewer, pinned to
     *  its own seat), or a solo game's two seats. */
    seatIds: readonly string[];
    /** The seat on screen — the one the notes are about. */
    viewerId: string;
    /** The `seq` of the state on screen. */
    seq: number | undefined;
}) {
    const mayJudge = canSubmitVerdicts(useCurrentUser());
    useVerdictProposalCapture(gameId, seatIds, mayJudge);
    if (!mayJudge || seq === undefined || !seatIds.includes(viewerId)) {
        return null;
    }
    // Keyed by seat: a solo seat switch never carries the other seat's draft.
    return (
        <DecisionCaptureNotes
            key={viewerId}
            gameId={gameId}
            seatId={viewerId}
            seq={seq}
        />
    );
}
