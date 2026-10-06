// Mount point for the Verdict Proposal capture of a vs-Bot game (issue #3984):
// records the human seat's decisions during play and samples them for the
// Brain at game end. Renders nothing — Board mounts it beside `VsAiDriver`
// only for vs-AI games.

import type { Id } from "@convex/_generated/dataModel";
import { useVerdictProposalCapture } from "~/hooks/useVerdictProposalCapture";

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
    useVerdictProposalCapture(gameId, botId, humanId);
    return null;
}
