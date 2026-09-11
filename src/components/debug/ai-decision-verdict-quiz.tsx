// The verdict quiz for one Bot decision (issue #3405, PRD #3397, ADR 0124 §1).
//
// "Which move here?" — the candidate list the decision's position offers, the
// Bot's own pick marked, and two gestures: confirm it (one tap) or name another
// candidate as the right play. What is submitted is a POSITION AND AN ANSWER,
// never numbers: `verdicts.submit` stores the lowered `ScenarioSpec` plus the
// candidate keys, and the fit re-derives the features from those whenever the
// evaluation's terms change.
//
// THE BUILDER IS LOADED ON DEMAND. `~/lib/ai/verdict-quiz` pulls the blade
// builder (`buildVerdictState`) so the position is rebuilt by exactly the
// function the fit will use — and that module graph reaches the blade registry,
// which has no business in the board's own bundle. A dynamic import puts it in
// its own chunk, fetched the first time a tester actually judges something.

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { AiTraceRecord } from "~/lib/ai/trace-store";
import { getAiTraceSource, markAiTraceJudged } from "~/lib/ai/trace-store";
import type { VerdictQuiz } from "~/lib/ai/verdict-quiz";
import { getStoredSession } from "~/lib/session";
import DebugButton from "./debug-button";
import AiDecisionQuizCandidate from "./ai-decision-quiz-candidate";

type QuizState =
    | { status: "loading" }
    | { status: "unbuildable"; error: string }
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

    const [state, setState] = useState<QuizState>({ status: "loading" });
    const [selected, setSelected] = useState<number | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const source = getAiTraceSource(record.id);
        if (!source) {
            // A decision pushed without its board — an older entry, or a
            // consult that had none. Said out loud rather than guessed: the
            // only board a verdict may carry is the one the search ran on.
            setState({
                status: "unbuildable",
                error: "the position this decision was taken on is no longer held — it cannot be judged",
            });
            return;
        }
        void import("~/lib/ai/verdict-quiz")
            .then(({ buildVerdictQuiz }) => {
                if (cancelled) return;
                const result = buildVerdictQuiz(record.trace, source);
                setState(
                    result.ok
                        ? { status: "ready", quiz: result.quiz }
                        : { status: "unbuildable", error: result.error }
                );
            })
            .catch((cause: unknown) => {
                if (cancelled) return;
                setState({
                    status: "unbuildable",
                    error: `the quiz could not be built: ${
                        cause instanceof Error ? cause.message : `${cause}`
                    }`,
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
                seat: "me",
                candidates: state.quiz.candidates,
                answer: { kind: "right", rightIndexes: [rightIndex] },
                ...(state.quiz.botPickIndex === undefined
                    ? {}
                    : { botPickIndex: state.quiz.botPickIndex }),
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
            <div className="flex flex-col gap-1">
                <p className="break-words text-[11px] text-danger-strong">
                    {state.error}
                </p>
                <DebugButton onClick={onClose}>Close</DebugButton>
            </div>
        );
    }

    const { quiz } = state;
    const botPickIndex = quiz.botPickIndex;
    return (
        <div className="flex flex-col gap-1.5 rounded-sm border border-border-accent/30 p-1.5">
            <span className="text-label">Which move was right here?</span>

            {botPickIndex !== undefined && (
                <DebugButton
                    onClick={() => void submit(botPickIndex)}
                    disabled={submitting}
                >
                    The Bot was right
                </DebugButton>
            )}
            {quiz.pickUnmatched && (
                <p className="break-words text-[10px] text-signal-pending">
                    {quiz.pickUnmatched}
                </p>
            )}

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

            {quiz.dropped.length > 0 && (
                // What the capture could not carry. A verdict given on a
                // position missing the stack, or a mana pool, is a judgement
                // about a different board — the tester decides, not the panel.
                <details>
                    <summary className="cursor-pointer text-[10px] text-text-disabled">
                        Not captured in this position ({quiz.dropped.length})
                    </summary>
                    <ul className="ml-3 list-disc text-[10px] text-text-muted">
                        {quiz.dropped.map((note, i) => (
                            <li key={i}>{note}</li>
                        ))}
                    </ul>
                </details>
            )}

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
