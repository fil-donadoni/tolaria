// The verdict quiz for one Bot decision (issue #3405, PRD #3397, ADR 0124 §1).
//
// "Which move here?" — the candidate list the decision's position offers, the
// Bot's own pick marked, and two gestures: confirm it (one tap) or name another
// candidate as the right play. What is submitted is a POSITION AND AN ANSWER,
// never numbers: `verdicts.submit` stores the lowered `ScenarioSpec` plus the
// candidate keys, and the fit re-derives the features from those whenever the
// evaluation's terms change.
//
// THE BUILDER IS LOADED ON DEMAND. `~/lib/ai/verdict-quiz` rebuilds the
// position through the blade base state and the engine's own enumerator — the
// same pair the fit uses — and that module graph is not small. A dynamic import
// puts it in its own chunk, fetched the first time a tester actually judges
// something rather than on every board load.

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AiTraceRecord } from "~/lib/ai/trace-store";
import { getAiTraceSource, markAiTraceJudged } from "~/lib/ai/trace-store";
import {
    QUIZ_SEAT,
    quizRefusal,
    type VerdictQuiz,
    type VerdictQuizRefusal,
} from "~/lib/ai/verdict-quiz";
import { getStoredSession } from "~/lib/session";
import DebugButton from "./debug-button";
import AiDecisionQuizCandidate from "./ai-decision-quiz-candidate";
import AiDecisionQuizRefusal from "./ai-decision-quiz-refusal";
import AiDecisionDroppedNotes from "./ai-decision-dropped-notes";

type QuizState =
    | { status: "loading" }
    | { status: "unbuildable"; refusal: VerdictQuizRefusal }
    | { status: "ready"; quiz: VerdictQuiz };

export default function AiDecisionVerdictQuiz({
    record,
    onClose,
}: {
    record: AiTraceRecord;
    onClose: () => void;
}) {
    const currentUser = useQuery(api.users.currentUser);
    const submitVerdict = useMutation(api.verdicts.submit);

    // A decision whose position the store no longer holds cannot be judged at
    // all, and that is knowable on the first render — so it is the INITIAL
    // state rather than something an effect corrects afterwards. The only
    // asynchronous part is loading the builder chunk below.
    const [state, setState] = useState<QuizState>(() =>
        getAiTraceSource(record.id)
            ? { status: "loading" }
            : {
                  status: "unbuildable",
                  refusal: quizRefusal(
                      "position-not-held",
                      "the position this decision was taken on is no longer held — it cannot be judged"
                  ),
              }
    );
    const [selected, setSelected] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        // A decision pushed without its board — an older ring entry, or a
        // consult that had none. Already said out loud by the initial state
        // above; there is nothing to load.
        const source = getAiTraceSource(record.id);
        if (!source) return;
        void import("~/lib/ai/verdict-quiz")
            .then(({ buildVerdictQuiz }) => {
                if (cancelled) return;
                const result = buildVerdictQuiz(record.trace, source);
                setState(
                    result.ok
                        ? { status: "ready", quiz: result.quiz }
                        : { status: "unbuildable", refusal: result.refusal }
                );
            })
            .catch((cause: unknown) => {
                if (cancelled) return;
                setState({
                    status: "unbuildable",
                    refusal: quizRefusal(
                        "builder-threw",
                        `the quiz could not be built: ${
                            cause instanceof Error ? cause.message : `${cause}`
                        }`
                    ),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [record]);

    async function submit(rightIndex: number) {
        if (state.status !== "ready" || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const { gameId } = getStoredSession();
            await submitVerdict({
                spec: state.quiz.spec,
                // The seat the lowering named — one constant, so the spec
                // and the row can never disagree about which side moved.
                seat: QUIZ_SEAT,
                candidates: state.quiz.candidates,
                answer: { kind: "right", rightIndexes: [rightIndex] },
                botPickIndex: state.quiz.botPickIndex,
                ...(gameId ? { gameId } : {}),
                ...(record.seq === undefined ? {} : { seq: record.seq }),
            });
            // Who judged it is shown to an admin only — a tester sees nothing
            // but their own judgements, so their own name tells them nothing.
            markAiTraceJudged(
                record.id,
                currentUser?.isAdmin ? currentUser.nickname : undefined
            );
            onClose();
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

    if (state.status === "loading") {
        return (
            <p className="text-[11px] text-text-disabled">
                Rebuilding this position…
            </p>
        );
    }

    if (state.status === "unbuildable") {
        return (
            <AiDecisionQuizRefusal
                refusal={state.refusal}
                decision={{
                    id: record.id,
                    ...(record.seq === undefined ? {} : { seq: record.seq }),
                }}
                onClose={onClose}
            />
        );
    }

    const { quiz } = state;
    const botPickIndex = quiz.botPickIndex;
    return (
        <div className="flex flex-col gap-1.5 rounded-sm border border-border-accent/30 p-1.5">
            <span className="text-label">Which move was right here?</span>

            <DebugButton
                onClick={() => void submit(botPickIndex)}
                disabled={submitting}
            >
                The Bot was right
            </DebugButton>

            <ul className="flex flex-col gap-0.5">
                {quiz.candidates.map((candidate, index) => (
                    <AiDecisionQuizCandidate
                        key={candidate.key}
                        description={candidate.description}
                        isBotPick={index === botPickIndex}
                        selected={index === selected}
                        disabled={submitting}
                        onSelect={() => setSelected(index)}
                    />
                ))}
            </ul>

            {selected !== null && (
                // The label stays a VERB, with the move it refers to on its own
                // line above: `DebugButton` is `whitespace-nowrap` by design,
                // and a sentence-long move description inside it renders a
                // button wider than the 293px sheet it sits in (#3403).
                <DebugButton
                    onClick={() => void submit(selected)}
                    disabled={submitting}
                >
                    {submitting ? "Submitting…" : "Submit as the right move"}
                </DebugButton>
            )}

            {/* What the capture could not carry. A verdict given on a position
                missing the stack, or a mid-flight payment, is a judgement about a
                different board — the tester decides, not the panel. Same
                disclosure the refusal renders, one component (issue #3457). */}
            <AiDecisionDroppedNotes notes={quiz.dropped} />

            {error && (
                <p className="break-words text-[10px] text-danger-strong">
                    {error}
                </p>
            )}

            <DebugButton onClick={onClose} disabled={submitting}>
                Cancel
            </DebugButton>
        </div>
    );
}
