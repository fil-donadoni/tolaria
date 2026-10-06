// The game-over offer of the post-game review queue (issue #3986): one button,
// shown only to an account that may give a Verdict and only once the finished
// game's Verdict Proposals have landed (they are judged by the Brain after the
// last move, so they arrive a moment after the dialog opens).

import { useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { canSubmitVerdicts } from "~/lib/adminGating";
import {
    getVerdictProposals,
    subscribeVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
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
    const count = list?.proposals.length ?? 0;
    const currentUser = useQuery(
        api.users.currentUser,
        count > 0 ? {} : "skip"
    );
    if (count === 0 || !canSubmitVerdicts(currentUser)) return null;
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
