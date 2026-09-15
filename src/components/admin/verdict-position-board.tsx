import type { ReviewVerdict } from "@convex/verdictReview";
import ScenarioSpecBoard from "@/components/debug/scenario-spec-board";
import { candidateMarks, decidingSeatLabels } from "./verdict-review-model";

/**
 * A position rebuilt from its Scenario Spec (issue #3582): the board with the
 * DECIDING seat's hand shown — a judgement about a land drop is worthless
 * without the hand it enables (ADR 0128 §12) — and the candidate list the
 * Bot's enumerator offered, each marked with the answers that name it.
 *
 * Every verdict at one position key shares the spec, the setup and the
 * candidate keys by construction, so the first one's are the position's.
 * The same renderer the quiz and the scenario preview use, never a second.
 */
export default function VerdictPositionBoard({
    verdicts,
}: {
    verdicts: readonly ReviewVerdict[];
}) {
    const { judgement } = verdicts[0];
    const marks = candidateMarks(verdicts);
    const setupSteps = judgement.setup?.length ?? 0;

    return (
        <div className="flex min-w-0 flex-col gap-3">
            <div className="rounded-sm border border-border-subtle p-3 text-sm [&_[data-testid=scenario-board]]:text-xs">
                <ScenarioSpecBoard
                    spec={judgement.spec}
                    revealedHands={[judgement.seat]}
                    seatLabels={decidingSeatLabels(judgement.seat)}
                />
            </div>
            {setupSteps > 0 && (
                <p className="text-xs text-text-muted">
                    {setupSteps} setup{" "}
                    {setupSteps === 1 ? "step walks" : "steps walk"} this board
                    to the decision; the board above is before them.
                </p>
            )}
            {(judgement.deckKnowledge?.length ?? 0) > 0 && (
                <p className="text-xs text-text-muted">
                    The search knew the decklist of{" "}
                    {judgement
                        .deckKnowledge!.map((k) =>
                            k.seat === judgement.seat
                                ? "the deciding seat"
                                : "the other seat"
                        )
                        .join(" and ")}
                    .
                </p>
            )}
            <div className="flex flex-col gap-1">
                <span className="text-label">Candidates</span>
                <ol
                    data-testid="verdict-candidates"
                    className="flex flex-col gap-1"
                >
                    {judgement.candidates.map((candidate, index) => (
                        <li
                            key={candidate.key}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-sm border border-border-subtle/40 px-2 py-1 text-sm"
                        >
                            <span className="min-w-0 break-words text-text">
                                {candidate.description}
                            </span>
                            {marks[index].length > 0 && (
                                <span className="text-xs text-accent-strong">
                                    {marks[index].join(" · ")}
                                </span>
                            )}
                        </li>
                    ))}
                </ol>
            </div>
        </div>
    );
}
