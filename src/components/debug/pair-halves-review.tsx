// The right-hand halves written so far, for any tester to check (issue #4801,
// PRD #4792, ADR 0148, user story 13). Beside the missing-halves queue, fed by
// the same snapshot — one Verdict Store read serves both lists.

import type { HalfToReview } from "@convex/verdictReview";
import PairHalfRow from "./pair-half-row";

export default function PairHalvesReview({
    halves,
}: {
    halves: readonly HalfToReview[];
}) {
    if (halves.length === 0) return null;
    return (
        <div data-testid="pair-halves-review" className="flex flex-col gap-1.5">
            <span className="text-label">
                Right-hand halves to check ({halves.length})
            </span>
            <ul className="flex flex-col gap-1">
                {halves.map((half) => (
                    <PairHalfRow key={half.halfId} half={half} />
                ))}
            </ul>
        </div>
    );
}
