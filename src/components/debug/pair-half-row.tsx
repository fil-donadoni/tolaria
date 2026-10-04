// One right-hand half a tester may check (issue #4801, PRD #4792, ADR 0148,
// user story 13): the position, the move it calls right and the Discriminant
// that makes it so, with the one gesture a disagreement needs.
//
// Disagreeing stores the tester's own answer at the half's position — the move
// is NOT right here — as a verdict of their own. Two answers to one position
// are a Contested Position, and the existing Verdict Resolution decides it:
// pairs need no second dispute mechanism.

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { HalfToReview } from "@convex/verdictReview";
import { halfDisagreementSubmission } from "~/lib/ai/verdict-pair";
import DebugButton from "./debug-button";
import ScenarioSpecBoard from "./scenario-spec-board";
import { quizSeatLabels } from "./ai-decision-quiz-copy";

export default function PairHalfRow({ half }: { half: HalfToReview }) {
    const submitVerdict = useMutation(api.verdicts.submit);
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [recorded, setRecorded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { judgement } = half;
    const rightMove =
        judgement.answer.kind === "right"
            ? judgement.candidates[judgement.answer.rightIndexes[0]]
                  ?.description
            : undefined;
    const discriminant = judgement.pairOf?.discriminant;

    async function disagree() {
        if (saving || recorded) return;
        setSaving(true);
        setError(null);
        try {
            await submitVerdict(halfDisagreementSubmission(judgement));
            setRecorded(true);
        } catch (cause: unknown) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "the judgement was refused"
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <li
            data-testid="pair-half-row"
            className="flex flex-col gap-1 rounded-sm border border-border-subtle p-1.5"
        >
            <span className="break-words text-[11px] text-text">
                Right here: {rightMove ?? "a move"}
                {half.anchorMove !== null && ` (wrong now: ${half.anchorMove})`}
            </span>
            {discriminant && (
                <span className="break-words text-[10px] text-text-muted">
                    Because of {discriminant.kind}: {discriminant.detail}
                </span>
            )}
            <DebugButton onClick={() => setOpen((v) => !v)}>
                {open ? "Hide the position" : "Show the position"}
            </DebugButton>
            {open && (
                <>
                    <ScenarioSpecBoard
                        spec={judgement.spec}
                        revealedHands={[judgement.seat]}
                        seatLabels={quizSeatLabels(judgement.seat)}
                    />
                    {recorded ? (
                        <p className="text-[10px] text-text-muted">
                            Recorded. Unless someone gave the same answer, the
                            position is now contested.
                        </p>
                    ) : (
                        <DebugButton
                            onClick={() => void disagree()}
                            disabled={saving}
                        >
                            Disagree: the move is not right here
                        </DebugButton>
                    )}
                    {error && (
                        <p className="break-words text-[10px] text-danger-strong">
                            {error}
                        </p>
                    )}
                </>
            )}
        </li>
    );
}
