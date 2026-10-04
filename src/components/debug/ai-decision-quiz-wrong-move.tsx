// Ruling a move wrong: which wrong, and for "now" the right-hand half (issue
// #4800, PRD #4792, ADR 0148).
//
// A judge who rules a move out says WHICH wrong they mean. "Always" is an
// Absolute Verdict and owes nothing more. "Now" is a Conditional Verdict: it
// names the Discriminant, is shown the right-hand position derived from the
// one being judged, and confirms the move is right there, touches that position
// up, or defers it. A Conditional Verdict alone would teach "never", so the
// fit reads it only beside its half — but a judge in the middle of a game must
// not be blocked on writing one, so the anchor is submitted on its own and
// waits in the Verdict Store for whoever completes it.
//
// TWO SUBMISSIONS, EACH A JUDGEMENT OF ITS OWN. The anchor is stored first and
// its id — the one `submit` will stamp, computed here from the same fields — is
// what the half's `pairOf` link names. Each carries its own attestation, so the
// pair's two claims are credited to whoever made each (user story 12). A half
// that fails after its anchor stored does not re-store the anchor on retry.

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { PairPosition } from "@convex/gre/ai/verdicts/pairDerivation";
import type {
    Discriminant,
    VerdictClassification,
} from "@convex/gre/ai/verdicts/types";
import { anchorIdOf, prefillRightHalf, withSpec } from "~/lib/ai/verdict-pair";
import type { RightHalfCheck } from "~/lib/ai/verdict-pair-build";
import { QUIZ_SEAT, type VerdictQuiz } from "~/lib/ai/verdict-quiz";
import { getStoredSession } from "~/lib/session";
import DebugButton from "./debug-button";
import AiDecisionQuizDiscriminant, {
    type DiscriminantChoice,
} from "./ai-decision-quiz-discriminant";
import AiDecisionQuizRightHalf, {
    type RightHalfStatus,
} from "./ai-decision-quiz-right-half";
import AiDecisionQuizTouchUp from "./ai-decision-quiz-touch-up";

type Stage =
    | { name: "classify" }
    | { name: "discriminant" }
    | { name: "half"; choice: DiscriminantChoice; position: PairPosition }
    | { name: "touch-up"; choice: DiscriminantChoice; position: PairPosition };

export default function AiDecisionQuizWrongMove({
    quiz,
    wrongIndex,
    seq,
    onDone,
    onBack,
}: {
    quiz: VerdictQuiz;
    /** The candidate ruled wrong. */
    wrongIndex: number;
    /** The state version the decision was taken at, when the ring knows it. */
    seq?: number;
    /** Everything the judge owed is stored: mark the decision judged. */
    onDone: () => void;
    onBack: () => void;
}) {
    const submitVerdict = useMutation(api.verdicts.submit);
    const [stage, setStage] = useState<Stage>({ name: "classify" });
    const [halfStatus, setHalfStatus] = useState<RightHalfStatus>({
        status: "checking",
    });
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // The anchor's classification once it is stored, so a retry after a failed
    // half does not store it twice. It also LOCKS the judgement: a second
    // anchor under another classification is a second verdict id at the same
    // position key — a Contested Position the judge would have made with
    // themself — so once the anchor is stored only its half is still owed.
    const anchorStored = useRef<string | null>(null);
    const [anchorLocked, setAnchorLocked] = useState(false);
    // Only the latest build may answer: a touch-up applied while the previous
    // build is still loading must not be overwritten by it.
    const buildToken = useRef(0);

    const provenance = () => {
        const { gameId } = getStoredSession();
        return {
            ...(gameId ? { gameId } : {}),
            ...(seq === undefined ? {} : { seq }),
        };
    };

    async function storeAnchor(classification: VerdictClassification) {
        const key = JSON.stringify(classification);
        if (anchorStored.current === key) return;
        await submitVerdict({
            spec: quiz.spec,
            seat: QUIZ_SEAT,
            candidates: quiz.candidates,
            answer: { kind: "forbidden", forbiddenIndexes: [wrongIndex] },
            classification,
            botPickIndex: quiz.botPickIndex,
            ...provenance(),
        });
        anchorStored.current = key;
        setAnchorLocked(true);
    }

    async function run(work: () => Promise<void>) {
        if (submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            await work();
            onDone();
        } catch (cause: unknown) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "the verdict was refused"
            );
        } finally {
            setSubmitting(false);
        }
    }

    const conditional = (
        discriminant: Discriminant
    ): VerdictClassification => ({ kind: "conditional", discriminant });

    async function build(
        choice: DiscriminantChoice,
        position: PairPosition
    ): Promise<void> {
        const token = ++buildToken.current;
        setHalfStatus({ status: "checking" });
        let check: RightHalfCheck;
        try {
            const { checkRightHalf } =
                await import("~/lib/ai/verdict-pair-build");
            check = checkRightHalf(
                quiz,
                wrongIndex,
                choice.discriminant,
                position
            );
        } catch (cause: unknown) {
            // A chunk that failed to load: the judge reads why, and can still
            // defer.
            check = {
                ok: false,
                reason: "build-threw",
                detail: `the right-hand position could not be built: ${
                    cause instanceof Error ? cause.message : `${cause}`
                }`,
            };
        }
        if (token === buildToken.current) {
            setHalfStatus({ status: "checked", check });
        }
    }

    function showHalf(choice: DiscriminantChoice, position: PairPosition) {
        setStage({ name: "half", choice, position });
        void build(choice, position);
    }

    function handleChosen(choice: DiscriminantChoice) {
        const prefill = prefillRightHalf(
            quiz,
            choice.discriminant,
            choice.change
        );
        if (!prefill.ok) {
            setError(prefill.error);
            return;
        }
        setError(null);
        showHalf(choice, prefill.value);
    }

    async function confirmHalf(
        choice: DiscriminantChoice,
        position: PairPosition
    ) {
        if (halfStatus.status !== "checked" || !halfStatus.check.ok) return;
        const { candidates, rightIndex } = halfStatus.check;
        await run(async () => {
            const classification = conditional(choice.discriminant);
            await storeAnchor(classification);
            await submitVerdict({
                spec: position.spec,
                ...(position.setup?.length ? { setup: position.setup } : {}),
                seat: position.seat,
                ...(position.deckKnowledge?.length
                    ? { deckKnowledge: position.deckKnowledge }
                    : {}),
                candidates,
                answer: { kind: "right", rightIndexes: [rightIndex] },
                pairOf: {
                    anchorId: anchorIdOf(quiz, wrongIndex, classification),
                    discriminant: choice.discriminant,
                },
                ...provenance(),
            });
        });
    }

    const defer = (discriminant: Discriminant) =>
        run(() => storeAnchor(conditional(discriminant)));

    const errorLine = error && (
        <p className="break-words text-[10px] text-danger-strong">{error}</p>
    );

    if (stage.name === "classify") {
        return (
            <div className="flex flex-col gap-1.5">
                <span className="text-label">
                    Is “{quiz.candidates[wrongIndex].description}” wrong always,
                    or wrong now?
                </span>
                <DebugButton
                    onClick={() =>
                        void run(() => storeAnchor({ kind: "absolute" }))
                    }
                    disabled={submitting}
                >
                    {submitting ? "Submitting…" : "Wrong always"}
                </DebugButton>
                <DebugButton
                    onClick={() => setStage({ name: "discriminant" })}
                    disabled={submitting}
                >
                    Wrong now
                </DebugButton>
                {errorLine}
                <DebugButton onClick={onBack} disabled={submitting}>
                    Back
                </DebugButton>
            </div>
        );
    }

    if (stage.name === "discriminant") {
        return (
            <>
                <AiDecisionQuizDiscriminant
                    disabled={submitting}
                    onChosen={handleChosen}
                    onDefer={(discriminant) => void defer(discriminant)}
                    onBack={() => {
                        setError(null);
                        setStage({ name: "classify" });
                    }}
                />
                {errorLine}
            </>
        );
    }

    if (stage.name === "touch-up") {
        const { choice, position } = stage;
        return (
            <AiDecisionQuizTouchUp
                spec={position.spec}
                onApply={(spec: ScenarioSpec) =>
                    showHalf(choice, withSpec(position, spec))
                }
                onCancel={() => setStage({ name: "half", choice, position })}
            />
        );
    }

    const { choice, position } = stage;
    return (
        <>
            <AiDecisionQuizRightHalf
                position={position}
                discriminant={choice.discriminant}
                judgedMove={quiz.candidates[wrongIndex].description}
                status={halfStatus}
                disabled={submitting}
                onConfirm={() => void confirmHalf(choice, position)}
                onTouchUp={() =>
                    setStage({ name: "touch-up", choice, position })
                }
                onDefer={() => void defer(choice.discriminant)}
                onBack={
                    anchorLocked
                        ? undefined
                        : () => {
                              setError(null);
                              setStage({ name: "discriminant" });
                          }
                }
            />
            {anchorLocked && (
                <p className="break-words text-[10px] text-text-muted">
                    The Conditional Verdict is already stored; only its
                    right-hand half is owed.
                </p>
            )}
            {errorLine}
        </>
    );
}
