// The game-over offer of the post-game review queue (issue #3986): one button,
// shown only to an account that may give a Verdict. While the game-end judge
// runs (the Brain judges the sampled decisions after the last move) it reads as a disabled progress line (issue #10229); once the finished
// game's Verdict Proposals land it becomes the review CTA. Leaving never waits
// for either.

import { useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { canSubmitVerdicts } from "~/lib/adminGating";
import {
    getVerdictJudging,
    getVerdictProposals,
    subscribeVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
import { verdictJudgingLabel } from "~/lib/ai/verdict-judging-label";
import { Button } from "~/components/ui/button";

export default function VerdictProposalOffer({
    gameId,
    onOpen,
}: {
    gameId: string;
    onOpen: () => void;
}) {
    const list = useSyncExternalStore(subscribeVerdictProposals, () =>
        getVerdictProposals(gameId)
    );
    const judging = useSyncExternalStore(subscribeVerdictProposals, () =>
        getVerdictJudging(gameId)
    );
    const count = list?.proposals.length ?? 0;
    const shown = count > 0 || (!list && judging !== null);
    const currentUser = useQuery(api.users.currentUser, shown ? {} : "skip");
    if (!shown || !canSubmitVerdicts(currentUser)) return null;
    if (count === 0 && judging) {
        return (
            <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled
                aria-busy
                className="mt-3 w-full"
            >
                {verdictJudgingLabel(judging)}
            </Button>
        );
    }
    return (
        <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onOpen}
            className="mt-3 w-full"
        >
            Review your decisions ({count})
        </Button>
    );
}
