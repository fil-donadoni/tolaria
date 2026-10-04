// Writing the right-hand half someone else deferred (issue #4801, PRD #4792,
// ADR 0148, user stories 11 and 12).
//
// The anchor is already stored, with its Discriminant — that is the judgement
// the first tester made and it does not change here. What is owed is the other
// position: the anchor's board with that one factor changed, where the same
// move is right. The writer shows it (prefilled from the kind's inputs, touch-up
// available), checks it builds, and stores it as a verdict of the writer's OWN:
// `verdicts.submit` stamps the writer's attestation on the half only, so the
// pair's two claims are credited to whoever made each. The link carries the
// anchor's Discriminant verbatim, or the pair would not be complete.

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { PairPosition } from "@convex/gre/ai/verdicts/pairDerivation";
import type { MissingHalf } from "@convex/verdictReview";
import {
    anchorToComplete,
    changeFromFields,
    initialFields,
    prefillRightHalf,
    rightHalfSubmission,
    withSpec,
} from "~/lib/ai/verdict-pair";
import type { RightHalfCheck } from "~/lib/ai/verdict-pair-build";
import DebugButton from "./debug-button";
import AiDecisionQuizChangeFields from "./ai-decision-quiz-change-fields";
import AiDecisionQuizRightHalf, {
    type RightHalfStatus,
} from "./ai-decision-quiz-right-half";
import AiDecisionQuizTouchUp from "./ai-decision-quiz-touch-up";

type Stage =
    | { name: "change" }
    | { name: "half"; position: PairPosition }
    | { name: "touch-up"; position: PairPosition };

export default function MissingHalfWriter({
    half,
    onDone,
    onClose,
}: {
    half: MissingHalf;
    /** The half is stored: the queue reloads without it. */
    onDone: () => void;
    onClose: () => void;
}) {
    const submitVerdict = useMutation(api.verdicts.submit);
    const anchor = anchorToComplete(half.judgement);
    const [stage, setStage] = useState<Stage>({ name: "change" });
    const [fields, setFields] = useState<Record<string, string>>(() =>
        anchor.ok ? initialFields(anchor.value.discriminant.kind) : {}
    );
    const [status, setStatus] = useState<RightHalfStatus>({
        status: "checking",
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Only the latest build may answer (see the quiz's own writer).
    const buildToken = useRef(0);

    if (!anchor.ok) {
        return (
            <div className="flex flex-col gap-1.5" role="alert">
                <p className="break-words text-[11px] text-danger-strong">
                    {anchor.error}
                </p>
                <DebugButton onClick={onClose}>Back to the queue</DebugButton>
            </div>
        );
    }
    const { quiz, wrongIndex, discriminant } = anchor.value;

    async function build(position: PairPosition) {
        const token = ++buildToken.current;
        setStatus({ status: "checking" });
        let check: RightHalfCheck;
        try {
            const { checkRightHalf } =
                await import("~/lib/ai/verdict-pair-build");
            check = checkRightHalf(quiz, wrongIndex, discriminant, position);
        } catch (cause: unknown) {
            check = {
                ok: false,
                reason: "build-threw",
                detail: `the right-hand position could not be built: ${
                    cause instanceof Error ? cause.message : `${cause}`
                }`,
            };
        }
        if (token === buildToken.current) {
            setStatus({ status: "checked", check });
        }
    }

    function show(position: PairPosition) {
        setStage({ name: "half", position });
        void build(position);
    }

    function showPrefill() {
        const change = changeFromFields(discriminant.kind, fields);
        if (!change.ok) {
            setError(change.error);
            return;
        }
        const prefill = prefillRightHalf(quiz, discriminant, change.value);
        if (!prefill.ok) {
            setError(prefill.error);
            return;
        }
        setError(null);
        show(prefill.value);
    }

    async function confirm(position: PairPosition) {
        if (submitting || status.status !== "checked" || !status.check.ok) {
            return;
        }
        const { candidates, rightIndex } = status.check;
        setSubmitting(true);
        setError(null);
        try {
            await submitVerdict(
                rightHalfSubmission(
                    position,
                    { candidates, rightIndex },
                    half.anchorId,
                    discriminant
                )
            );
            onDone();
        } catch (cause: unknown) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "the right-hand half was refused"
            );
        } finally {
            setSubmitting(false);
        }
    }

    const errorLine = error && (
        <p className="break-words text-[10px] text-danger-strong">{error}</p>
    );

    if (stage.name === "touch-up") {
        const { position } = stage;
        return (
            <AiDecisionQuizTouchUp
                spec={position.spec}
                onApply={(spec: ScenarioSpec) => show(withSpec(position, spec))}
                onCancel={() => setStage({ name: "half", position })}
            />
        );
    }

    if (stage.name === "half") {
        const { position } = stage;
        return (
            <>
                <AiDecisionQuizRightHalf
                    position={position}
                    discriminant={discriminant}
                    judgedMove={quiz.candidates[wrongIndex].description}
                    status={status}
                    disabled={submitting}
                    onConfirm={() => void confirm(position)}
                    onTouchUp={() => setStage({ name: "touch-up", position })}
                    onDefer={onClose}
                    deferLabel="Leave it in the queue"
                    onBack={() => {
                        setError(null);
                        setStage({ name: "change" });
                    }}
                />
                {errorLine}
            </>
        );
    }

    return (
        <div className="flex flex-col gap-1.5">
            <span className="text-label">
                Wrong now: {quiz.candidates[wrongIndex].description}
            </span>
            <p
                className="break-words text-[10px] text-text-muted"
                data-testid="pair-discriminant"
            >
                {discriminant.kind}: {discriminant.detail}
            </p>
            <AiDecisionQuizChangeFields
                kind={discriminant.kind}
                fields={fields}
                disabled={submitting}
                onChange={(key, value) =>
                    setFields((prev) => ({ ...prev, [key]: value }))
                }
            />
            {errorLine}
            <DebugButton variant="primary" onClick={showPrefill}>
                Show the right-hand position
            </DebugButton>
            <DebugButton onClick={onClose}>Back to the queue</DebugButton>
        </div>
    );
}
