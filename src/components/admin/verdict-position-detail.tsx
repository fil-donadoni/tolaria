import type { ReviewPosition } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import VerdictAnswerCard from "./verdict-answer-card";
import VerdictPositionBoard from "./verdict-position-board";
import VerdictResolutionForm from "./verdict-resolution-form";
import { authorLabel, dateLabel } from "./verdict-review-model";

/**
 * One contested or resolved position (issue #3582): the board rebuilt from
 * its spec, the answers side by side with who gave each, and — while it is
 * contested — the form that settles it.
 */
export default function VerdictPositionDetail({
    position,
    onBack,
    onResolved,
}: {
    position: ReviewPosition;
    onBack: () => void;
    onResolved: () => void;
}) {
    const { resolution, staleResolution } = position;
    const reasons = new Map(
        (resolution?.rejected ?? []).map((r) => [r.verdictId, r.reason])
    );

    return (
        <section
            data-testid="verdict-position-detail"
            className="flex min-w-0 flex-col gap-4"
        >
            <div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                >
                    ← All positions
                </Button>
            </div>
            <VerdictPositionBoard verdicts={position.verdicts} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {position.verdicts.map((verdict, index) => (
                    <VerdictAnswerCard
                        key={verdict.verdictId}
                        verdict={verdict}
                        index={index}
                        verdictState={
                            resolution === null
                                ? undefined
                                : verdict.verdictId ===
                                    resolution.acceptedVerdictId
                                  ? { accepted: true }
                                  : {
                                        accepted: false,
                                        reason:
                                            reasons.get(verdict.verdictId) ??
                                            "",
                                    }
                        }
                    />
                ))}
            </div>
            {resolution !== null ? (
                <p className="break-words text-sm text-text-muted">
                    Resolved by {authorLabel(resolution)}
                    {dateLabel(resolution.createdAt) &&
                        ` on ${dateLabel(resolution.createdAt)}`}
                    {resolution.acceptedVerdictId === null &&
                        " — none of the answers is right"}
                    {resolution.note && ` — “${resolution.note}”`}
                </p>
            ) : (
                <>
                    {staleResolution !== null && (
                        <p className="break-words text-sm text-text-muted">
                            {authorLabel(staleResolution)} resolved this
                            position before its latest answer arrived; a
                            decision about fewer answers does not cover it.
                        </p>
                    )}
                    <VerdictResolutionForm
                        position={position}
                        onResolved={onResolved}
                    />
                </>
            )}
        </section>
    );
}
