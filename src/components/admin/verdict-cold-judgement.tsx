import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ReviewVerdict } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import AiDecisionQuizCandidate from "@/components/debug/ai-decision-quiz-candidate";
import VerdictAnswerCard from "./verdict-answer-card";
import VerdictPositionBoard from "./verdict-position-board";

/**
 * One verdict opened cold (issue #3582, ADR 0128): the position rebuilt away
 * from the table, the answer on record, and a judgement of your own.
 *
 * The judgement goes through the same door as the quiz's — `verdicts.submit`,
 * tester-gated — carrying the position exactly as stored, decklist knowledge
 * included, so it keys to the same position. Agreeing adds an attestation to
 * the verdict on record; disagreeing makes the position contested, and it
 * appears in the list above to be resolved.
 */
export default function VerdictColdJudgement({
    verdict,
}: {
    verdict: ReviewVerdict;
}) {
    const submitVerdict = useMutation(api.verdicts.submit);
    const [selected, setSelected] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const [recorded, setRecorded] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { judgement } = verdict;

    async function submit() {
        if (selected === null || saving) return;
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
                answer: { kind: "right", rightIndexes: [selected] },
            });
            setRecorded(true);
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
                <ul className="flex flex-col gap-1">
                    {judgement.candidates.map((candidate, index) => (
                        <AiDecisionQuizCandidate
                            key={candidate.key}
                            description={candidate.description}
                            isBotPick={false}
                            selected={index === selected}
                            disabled={saving || recorded}
                            onSelect={() => setSelected(index)}
                        />
                    ))}
                </ul>
                {recorded ? (
                    <p className="text-sm text-text-muted">
                        Recorded. If it matches the answer on record it attests
                        it; if not, the position is now contested.
                    </p>
                ) : (
                    <div>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => void submit()}
                            disabled={selected === null || saving}
                        >
                            {saving ? "Recording…" : "Record as the right move"}
                        </Button>
                    </div>
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
