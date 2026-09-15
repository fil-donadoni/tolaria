import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { VerdictAnswer } from "@convex/gre/ai/verdicts/types";
import type { ReviewVerdict } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import AiDecisionQuizCandidate from "@/components/debug/ai-decision-quiz-candidate";
import VerdictAnswerCard from "./verdict-answer-card";
import VerdictPositionBoard from "./verdict-position-board";

/**
 * One verdict opened cold (issue #3582, ADR 0128): the position rebuilt away
 * from the table, the answer on record, and a judgement of your own.
 *
 * Two gestures, because an answer is not always one move. AGREE submits the
 * answer on record exactly — several right moves, or a forbidden one — and
 * so attests that verdict. Naming a single right move submits THAT answer,
 * which is the same verdict only when the record names exactly that move as
 * right; otherwise it contests the position, and the position appears in the
 * list above to be resolved.
 *
 * Both go through the quiz's door — `verdicts.submit`, tester-gated — with
 * the position exactly as stored, decklist knowledge included, so the
 * judgement keys to the same position.
 */
export default function VerdictColdJudgement({
    verdict,
}: {
    verdict: ReviewVerdict;
}) {
    const submitVerdict = useMutation(api.verdicts.submit);
    const [selected, setSelected] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [recorded, setRecorded] = useState<"agreed" | "judged" | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { judgement } = verdict;

    async function submit(answer: VerdictAnswer, outcome: "agreed" | "judged") {
        if (saving || recorded !== null) return;
        setSaving(true);
        setError(null);
        try {
            await submitVerdict({
                spec: judgement.spec,
                ...(judgement.setup?.length ? { setup: judgement.setup } : {}),
                seat: judgement.seat,
                ...(judgement.deckKnowledge?.length
                    ? { deckKnowledge: judgement.deckKnowledge }
                    : {}),
                candidates: judgement.candidates,
                answer,
            });
            setRecorded(outcome);
        } catch (cause) {
            setError(
                cause instanceof Error
                    ? cause.message
                    : "The judgement was refused"
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <section
            data-testid="verdict-cold-judgement"
            className="flex min-w-0 flex-col gap-4"
        >
            <VerdictPositionBoard verdicts={[verdict]} />
            <VerdictAnswerCard verdict={verdict} index={0} />
            <div className="flex flex-col gap-2">
                <span className="text-label">Your judgement</span>
                <div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void submit(judgement.answer, "agreed")}
                        disabled={saving || recorded !== null}
                    >
                        Agree with the answer on record
                    </Button>
                </div>
                <p className="text-xs text-text-muted">
                    Or name the one move that was right:
                </p>
                <ul className="flex flex-col gap-1">
                    {judgement.candidates.map((candidate, index) => (
                        <AiDecisionQuizCandidate
                            key={candidate.key}
                            description={candidate.description}
                            isBotPick={false}
                            selected={index === selected}
                            disabled={saving || recorded !== null}
                            onSelect={() => setSelected(index)}
                        />
                    ))}
                </ul>
                {recorded === null ? (
                    <div>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                                selected !== null &&
                                void submit(
                                    { kind: "right", rightIndexes: [selected] },
                                    "judged"
                                )
                            }
                            disabled={selected === null || saving}
                        >
                            {saving ? "Recording…" : "Record as the right move"}
                        </Button>
                    </div>
                ) : (
                    <p className="text-sm text-text-muted">
                        {recorded === "agreed"
                            ? "Recorded: your attestation of the answer on record."
                            : "Recorded. Unless the record names exactly that move as right, the position is now contested."}
                    </p>
                )}
                {error && (
                    <p className="break-words text-xs text-danger-strong">
                        {error}
                    </p>
                )}
            </div>
        </section>
    );
}
