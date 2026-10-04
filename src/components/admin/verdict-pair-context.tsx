import type { ReviewPairContext } from "@convex/verdictReview";
import VerdictAnswerCard from "./verdict-answer-card";
import VerdictPositionBoard from "./verdict-position-board";
import { discriminantLabel } from "./verdict-review-model";

/**
 * The other half of a Minimal Pair, shown beside the verdict being judged
 * (issue #4801, PRD #4792, ADR 0148, user story 34): the Discriminant — the one
 * factor whose change makes the same move right — and the position on the far
 * side of it. An anchor shows its right-hand half (or says it is still owed);
 * a half shows its anchor. A judge agreeing with "wrong now" sees the whole
 * argument, not the half of it that was ruled on first.
 */
export default function VerdictPairContext({
    pair,
}: {
    pair: ReviewPairContext;
}) {
    return (
        <section
            data-testid="verdict-pair-context"
            className="flex min-w-0 flex-col gap-3 rounded-sm border border-border-subtle p-3"
        >
            <header className="flex flex-col gap-0.5">
                <span className="text-label">
                    {pair.role === "anchor"
                        ? "Wrong now — Minimal Pair"
                        : "Right-hand half of a Minimal Pair"}
                </span>
                <span
                    data-testid="verdict-pair-discriminant"
                    className="break-words text-sm text-text"
                >
                    Discriminant — {discriminantLabel(pair.discriminant)}
                </span>
            </header>
            {pair.role === "anchor" && pair.halves.length === 0 && (
                <p
                    data-testid="verdict-pair-missing"
                    className="text-sm text-text-muted"
                >
                    The right-hand half is still owed.
                </p>
            )}
            {pair.role === "anchor" &&
                pair.halves.map((half) => (
                    <div
                        key={half.verdictId}
                        data-testid="verdict-pair-half"
                        className="flex min-w-0 flex-col gap-2"
                    >
                        <span className="text-label">Right-hand half</span>
                        <VerdictPositionBoard verdicts={[half]} />
                        <VerdictAnswerCard verdict={half} index={0} />
                    </div>
                ))}
            {pair.role === "half" && pair.anchor === null && (
                <p
                    data-testid="verdict-pair-missing"
                    className="text-sm text-text-muted"
                >
                    Its anchor is not in the store.
                </p>
            )}
            {pair.role === "half" && pair.anchor !== null && (
                <div
                    data-testid="verdict-pair-anchor"
                    className="flex min-w-0 flex-col gap-2"
                >
                    <span className="text-label">Anchor</span>
                    <VerdictPositionBoard verdicts={[pair.anchor]} />
                    <VerdictAnswerCard verdict={pair.anchor} index={0} />
                </div>
            )}
        </section>
    );
}
