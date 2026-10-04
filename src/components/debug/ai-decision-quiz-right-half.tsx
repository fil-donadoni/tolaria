// The prefilled right-hand position of a Conditional Verdict (issue #4800,
// PRD #4792, ADR 0148).
//
// What the judge sees is the whole argument: the position the move was ruled
// wrong in is above, the copied position with only the Discriminant changed is
// here, and the question is whether the SAME move is right on it. Three
// gestures — confirm, touch up, defer — and one refusal, shown in its own
// words: a half the derivation cannot stand behind (a `sequence` move that
// leaves no trace on the board, the anchor's own position, a move the half does
// not offer) is not a pair, and saying why is the whole point (user story 8).

import type { RightHalfCheck } from "~/lib/ai/verdict-pair-build";
import type { Discriminant } from "@convex/gre/ai/verdicts/types";
import type { PairPosition } from "@convex/gre/ai/verdicts/pairDerivation";
import { QUIZ_SEAT } from "~/lib/ai/verdict-quiz";
import DebugButton from "./debug-button";
import ScenarioSpecBoard from "./scenario-spec-board";
import { quizSeatLabels } from "./ai-decision-quiz-copy";

export type RightHalfStatus =
    | { status: "checking" }
    | { status: "checked"; check: RightHalfCheck };

export default function AiDecisionQuizRightHalf({
    position,
    discriminant,
    judgedMove,
    status,
    disabled,
    onConfirm,
    onTouchUp,
    onDefer,
    deferLabel = "Defer the right-hand half",
    onBack,
}: {
    position: PairPosition;
    discriminant: Discriminant;
    /** The move the anchor ruled out, in the describer's sentence. */
    judgedMove: string;
    status: RightHalfStatus;
    disabled: boolean;
    onConfirm: () => void;
    onTouchUp: () => void;
    onDefer: () => void;
    /** The defer button's words: the queue's writer leaves the half where it
     *  is rather than deferring it a first time. */
    deferLabel?: string;
    /** Absent once the anchor is stored: the judgement can no longer change. */
    onBack?: () => void;
}) {
    const refused =
        status.status === "checked" && !status.check.ok ? status.check : null;
    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-label">
                The same position, with one thing changed
            </span>
            <p
                className="break-words text-[10px] text-text-muted"
                data-testid="pair-discriminant"
            >
                {discriminant.kind}: {discriminant.detail}
            </p>
            <ScenarioSpecBoard
                spec={position.spec}
                revealedHands={[QUIZ_SEAT]}
                seatLabels={quizSeatLabels(QUIZ_SEAT)}
            />
            {position.setup !== undefined && position.setup.length > 0 && (
                <p
                    className="break-words font-mono text-[10px] text-text-muted"
                    data-testid="pair-setup"
                >
                    Earlier move: {JSON.stringify(position.setup)}
                </p>
            )}

            {status.status === "checking" && (
                <p className="text-[11px] text-text-disabled">
                    Building the right-hand position…
                </p>
            )}
            {refused !== null && !refused.ok && (
                <div className="flex flex-col gap-0.5" role="alert">
                    <span
                        className="break-words text-[11px] font-semibold text-danger-strong"
                        data-testid="pair-refusal"
                        data-refusal-reason={refused.reason}
                    >
                        This pair cannot be formed
                    </span>
                    <p className="break-words text-[10px] text-text-muted">
                        {refused.detail}
                    </p>
                </div>
            )}
            {status.status === "checked" && status.check.ok && (
                <p className="break-words text-[11px] text-text-muted">
                    Is “{judgedMove}” right here?
                </p>
            )}

            <DebugButton
                variant="primary"
                onClick={onConfirm}
                disabled={
                    disabled || status.status !== "checked" || !status.check.ok
                }
            >
                The move is right here
            </DebugButton>
            <DebugButton onClick={onTouchUp} disabled={disabled}>
                Touch up the position
            </DebugButton>
            <DebugButton onClick={onDefer} disabled={disabled}>
                {deferLabel}
            </DebugButton>
            {onBack && (
                <DebugButton onClick={onBack} disabled={disabled}>
                    Back
                </DebugButton>
            )}
        </div>
    );
}
