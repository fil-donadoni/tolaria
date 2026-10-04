// One entry of the missing-halves queue (issue #4801, PRD #4792, ADR 0148): a
// Conditional Verdict whose right-hand half nobody has written, said in the
// words of the move it ruled out and the Discriminant it named.

import type { MissingHalf } from "@convex/verdictReview";
import DebugButton from "./debug-button";

export default function MissingHalfRow({
    half,
    onOpen,
}: {
    half: MissingHalf;
    onOpen: () => void;
}) {
    const { judgement } = half;
    const ruledOut =
        judgement.answer.kind === "forbidden"
            ? judgement.answer.forbiddenIndexes
                  .map((i) => judgement.candidates[i]?.description)
                  .filter((d): d is string => d !== undefined)
                  .join(" / ")
            : "";
    const discriminant =
        judgement.classification?.kind === "conditional"
            ? judgement.classification.discriminant
            : null;
    return (
        <li
            data-testid="missing-half-row"
            className="flex flex-col gap-1 rounded-sm border border-border-subtle p-1.5"
        >
            <span className="break-words text-[11px] text-text">
                Wrong now: {ruledOut || "a move"}
            </span>
            {discriminant && (
                <span className="break-words text-[10px] text-text-muted">
                    Because of {discriminant.kind}: {discriminant.detail}
                </span>
            )}
            <DebugButton onClick={onOpen}>
                Write the right-hand half
            </DebugButton>
        </li>
    );
}
