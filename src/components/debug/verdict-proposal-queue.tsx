// The post-game review queue (issue #3986, PRD #3980, GLOSSARY.md § Verdict
// Proposal): the finished game's Verdict Proposals, one at a time, through the
// SAME quiz the debug ring opens — fed from each proposal's captured view
// instead of the ring, submitting through `verdicts.submit` unchanged.
//
// Tester-gated like the mutation it ends in (`canSubmitVerdicts` mirrors
// `assertIsTester`): a judgement from an account the corpus does not trust yet
// would need its own onboarding. Skipping is free — a proposal nobody answers
// records nothing, and the list goes away with the game.

import { useMemo, useState, useSyncExternalStore } from "react";
import {
    getVerdictProposals,
    subscribeVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
import { proposalQuizSubject } from "~/lib/ai/verdict-quiz";
import DebugButton from "./debug-button";
import AiDecisionVerdictQuiz from "./ai-decision-verdict-quiz";

export default function VerdictProposalQueue({
    gameId,
    onClose,
}: {
    gameId: string;
    /** Leave the queue — what is left unanswered records nothing. */
    onClose: () => void;
}) {
    const list = useSyncExternalStore(subscribeVerdictProposals, () =>
        getVerdictProposals(gameId)
    );
    const proposals = useMemo(() => list?.proposals ?? [], [list]);
    const [index, setIndex] = useState(0);
    const [judged, setJudged] = useState(0);
    const proposal = proposals[index];
    // Built once per proposal: the quiz rebuilds its position whenever the
    // subject changes identity.
    const subject = useMemo(
        () => (proposal ? proposalQuizSubject(proposal, index, gameId) : null),
        [proposal, index, gameId]
    );

    const next = () => setIndex((i) => i + 1);

    return (
        <div
            data-testid="verdict-proposal-queue"
            className="flex w-full min-w-0 flex-col gap-1.5 text-left text-[11px]"
        >
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-label">Review your decisions</span>
                <span className="text-text-disabled">
                    {Math.min(index + 1, proposals.length)} / {proposals.length}
                </span>
            </div>
            {subject ? (
                <>
                    <p className="break-words text-[10px] text-text-muted">
                        {proposal.agrees
                            ? "The Bot would have made the same play. Was it right?"
                            : "The Bot would have played differently. Which move was right?"}
                    </p>
                    <AiDecisionVerdictQuiz
                        key={index}
                        subject={subject}
                        onJudged={() => setJudged((n) => n + 1)}
                        onClose={next}
                        // Skipping is the quiz's own leave button: it is
                        // locked while an answer is being stored, so a skip
                        // can never race the submission it would orphan.
                        cancelLabel="Skip"
                    />
                </>
            ) : (
                <p className="text-text-disabled">
                    {judged === 0
                        ? "No decision judged."
                        : `${judged} decision${judged === 1 ? "" : "s"} judged.`}
                </p>
            )}
            <DebugButton onClick={onClose}>Done</DebugButton>
        </div>
    );
}
