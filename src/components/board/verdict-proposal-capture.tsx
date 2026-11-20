// Mount point for the Verdict Proposal capture of a vs-Bot game (issue #3984):
// records the human seat's decisions during play and samples them for the
// Brain at game end. Renders nothing — Board mounts it beside `VsAiDriver`
// only for vs-AI games. Runs for an account that may give a Verdict only
// (issue #10229): no one else is offered the review it feeds.

import type { Id } from "@convex/_generated/dataModel";
import { useVerdictProposalCapture } from "~/hooks/useVerdictProposalCapture";
import { useCurrentUser } from "~/hooks/useCurrentUser";
import { canSubmitVerdicts } from "~/lib/adminGating";

export default function VerdictProposalCapture({
    gameId,
    botId,
    humanId,
}: {
    gameId: Id<"games">;
    botId: string | null;
    /** The human seat — the viewer, pinned to its own seat in vs-AI. */
    humanId: string | null;
}) {
    const mayJudge = canSubmitVerdicts(useCurrentUser());
    useVerdictProposalCapture(gameId, botId, humanId, mayJudge);
    return null;
}
