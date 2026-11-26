// The verdict quiz for one decision (issue #3405, PRD #3397, ADR 0124 §1) —
// a Bot decision from the debug ring, or one of the player's own decisions
// offered back after the game as a Verdict Proposal (issue #3986). Both reach
// it as a `QuizSubject`; what it submits does not depend on which.
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
import {
    QUIZ_SEAT,
    describeCause,
    quizRefusal,
    type QuizSubject,
} from "~/lib/ai/verdict-quiz";
import { getStoredSession } from "~/lib/session";
import type { QuizState } from "./ai-decision-verdict-quiz-settle";
import {
    reportQuizFailure,
    settleQuiz,
} from "./ai-decision-verdict-quiz-settle";
import DebugButton from "./debug-button";
import AiDecisionQuizCandidate from "./ai-decision-quiz-candidate";
import AiDecisionQuizRefusal from "./ai-decision-quiz-refusal";
import AiDecisionDroppedNotes from "./ai-decision-dropped-notes";
import AiDecisionQuizHandReveal from "./ai-decision-quiz-hand-reveal";
import AiDecisionQuizWrongMove from "./ai-decision-quiz-wrong-move";
import ScenarioSpecBoard from "./scenario-spec-board";
import {
    OWN_HAND_REMINDER,
    PROPOSAL_HAND_NOTE,
    candidateSentence,
    quizSeatLabelsFor,
    type QuizPerspective,
} from "./ai-decision-quiz-copy";

export default function AiDecisionVerdictQuiz({
    subject,
    onJudged,
    onClose,
    cancelLabel = "Cancel",
}: {
    subject: QuizSubject;
    /** Everything the judge owed is stored; `author` is the judge's nickname,
     *  given only to an admin. */
    onJudged: (author?: string) => void;
    onClose: () => void;
    /** The leave-without-judging button's words — "Skip" in the post-game
     *  queue, where leaving one decision opens the next. */
    cancelLabel?: string;
}) {
    const currentUser = useQuery(api.users.currentUser);
    const submitVerdict = useMutation(api.verdicts.submit);

    // A decision whose position the store no longer holds cannot be judged at
    // all, and that is knowable on the first render — so it is the INITIAL
    // state rather than something an effect corrects afterwards. The only
    // asynchronous part is loading the builder chunk below.
    const { feed } = subject;
    // Whose decision this is: on a proposal the deciding seat is the reader.
    const perspective: QuizPerspective =
        feed?.kind === "proposal" ? "player" : "bot";
    const [state, setState] = useState<QuizState>(() =>
        feed
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
    // Ruling the selected move wrong (issue #4800, ADR 0148): its own flow, with
    // its own submissions, entered from the selection and left by Back or by
    // everything it owed being stored.
    const [ruling, setRuling] = useState(false);
    // Hidden on every opening: the reveal is consented to per judgement, never
    // remembered into the next one (ADR 0128 §12).
    const [handRevealed, setHandRevealed] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        // A decision pushed without its board — an older ring entry, or a
        // consult that had none. Already said out loud by the initial state
        // above; there is nothing to load.
        if (!feed) return;
        // Building NEVER rejects: it settles into the state to show. Publishing
        // that state is a separate step below, because an error React raises
        // from the panel's own `setState` is not a builder failure (issue
        // #9822) and must not be filed as one.
        void settleQuiz(feed, (cause) =>
            reportQuizFailure(cause, subject, "build")
        ).then((settled) => {
            if (cancelled) return;
            try {
                setState(settled);
            } catch (cause: unknown) {
                reportQuizFailure(cause, subject, "publish");
                try {
                    setState({
                        status: "unbuildable",
                        refusal: quizRefusal(
                            "panel-update-threw",
                            `the panel could not publish its result: ${describeCause(cause)}`
                        ),
                    });
                } catch {
                    // The update loop refuses this one too; it is reported.
                }
            }
        });
        return () => {
            cancelled = true;
        };
        // `subject` is read only to name the decision in a report.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feed]);

    function finish() {
        // Who judged it is shown to an admin only — a tester sees nothing
        // but their own judgements, so their own name tells them nothing.
        onJudged(currentUser?.isAdmin ? currentUser.nickname : undefined);
        onClose();
    }

    async function submit(rightIndex: number) {
        if (state.status !== "ready" || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            const gameId = subject.gameId ?? getStoredSession().gameId;
            await submitVerdict({
                spec: state.quiz.spec,
                // The seat the lowering named — one constant, so the spec
                // and the row can never disagree about which side moved.
                seat: QUIZ_SEAT,
                candidates: state.quiz.candidates,
                answer: { kind: "right", rightIndexes: [rightIndex] },
                botPickIndex: state.quiz.botPickIndex,
                ...(gameId ? { gameId } : {}),
                ...(subject.seq === undefined ? {} : { seq: subject.seq }),
                // The Plan and words said during play (issue #10088).
                ...(subject.reading ?? {}),
            });
            finish();
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
                    id: subject.id,
                    ...(subject.seq === undefined ? {} : { seq: subject.seq }),
                    ...(perspective === "player" ? { proposal: true } : {}),
                }}
                onClose={onClose}
            />
        );
    }

    const { quiz } = state;
    const botPickIndex = quiz.botPickIndex;
    const playerPickIndex = quiz.playerPickIndex;

    if (ruling && selected !== null) {
        return (
            <div className="flex flex-col gap-1.5 rounded-sm border border-border-accent/30 p-1.5">
                <AiDecisionQuizWrongMove
                    quiz={quiz}
                    wrongIndex={selected}
                    seq={subject.seq}
                    perspective={perspective}
                    {...(subject.reading ? { reading: subject.reading } : {})}
                    {...(subject.gameId === undefined
                        ? {}
                        : { gameId: subject.gameId })}
                    onDone={finish}
                    onBack={() => setRuling(false)}
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1.5 rounded-sm border border-border-accent/30 p-1.5">
            <span className="text-label">Which move was right here?</span>

            {/* The position being judged, from the spec that is submitted —
                the same reading every scenario surface uses (issue #3577).
                Only the deciding seat's hand can be revealed; the opponent's
                is a count, which is what the spec carries and what the Bot
                knew. */}
            <ScenarioSpecBoard
                spec={quiz.spec}
                revealedHands={
                    handRevealed || perspective === "player" ? [QUIZ_SEAT] : []
                }
                seatLabels={quizSeatLabelsFor(QUIZ_SEAT, perspective)}
            />
            {perspective === "bot" && (
                <AiDecisionQuizHandReveal
                    revealed={handRevealed}
                    disabled={submitting}
                    onChange={setHandRevealed}
                />
            )}
            <p className="break-words text-[10px] text-text-muted">
                {perspective === "player"
                    ? PROPOSAL_HAND_NOTE
                    : OWN_HAND_REMINDER}
            </p>

            <DebugButton
                onClick={() => void submit(botPickIndex)}
                disabled={submitting}
            >
                The Bot was right
            </DebugButton>
            {playerPickIndex !== undefined &&
                playerPickIndex !== botPickIndex && (
                    <DebugButton
                        onClick={() => void submit(playerPickIndex)}
                        disabled={submitting}
                    >
                        My move was right
                    </DebugButton>
                )}

            <ul className="flex flex-col gap-0.5">
                {quiz.candidates.map((candidate, index) => (
                    <AiDecisionQuizCandidate
                        key={candidate.key}
                        description={candidateSentence(
                            candidate.description,
                            perspective
                        )}
                        isBotPick={index === botPickIndex}
                        isPlayerPick={index === playerPickIndex}
                        {...(perspective === "player"
                            ? { botPickLabel: "Bot's pick" }
                            : {})}
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
            {selected !== null && (
                <DebugButton
                    onClick={() => setRuling(true)}
                    disabled={submitting}
                >
                    Rule this move wrong
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
                {cancelLabel}
            </DebugButton>
        </div>
    );
}
