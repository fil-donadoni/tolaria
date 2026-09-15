import type { ReviewVerdict } from "@convex/verdictReview";
import {
    answerLetter,
    answerReading,
    authorLabel,
    dateLabel,
} from "./verdict-review-model";

/**
 * One answer about a position, with every person who gave it (issue #3582).
 * Rendered side by side with the others, so the disagreement is read at a
 * glance: what each answer names, and who stands behind it. A resolved
 * position marks the answer accepted or rejected, and a rejected one keeps its
 * reason on the card — it is evidence, not something that was deleted.
 */
export default function VerdictAnswerCard({
    verdict,
    index,
    verdictState,
}: {
    verdict: ReviewVerdict;
    index: number;
    verdictState?: { accepted: true } | { accepted: false; reason: string };
}) {
    const reading = answerReading(verdict.judgement);
    const { botPickIndex } = verdict.attestations.find(
        (a) => a.botPickIndex !== undefined
    ) ?? { botPickIndex: undefined };
    const botPick =
        botPickIndex === undefined
            ? null
            : verdict.judgement.candidates[botPickIndex]?.description;

    return (
        <article
            data-testid="verdict-answer-card"
            className="flex min-w-0 flex-col gap-2 rounded-sm border border-border-subtle p-3"
        >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold text-text">
                    Answer {answerLetter(index)}
                </h3>
                {verdictState && (
                    <span
                        className={`text-xs ${
                            verdictState.accepted
                                ? "text-signal-self"
                                : "text-danger-strong"
                        }`}
                    >
                        {verdictState.accepted ? "Accepted" : "Rejected"}
                    </span>
                )}
            </header>
            <div className="flex flex-col gap-0.5 text-sm">
                <span className="text-label">{reading.kind}</span>
                <ul className="ml-4 list-disc text-text">
                    {reading.moves.map((move, i) => (
                        <li key={i} className="break-words">
                            {move}
                        </li>
                    ))}
                </ul>
            </div>
            {verdictState && !verdictState.accepted && (
                <p className="break-words text-xs text-text-muted">
                    Why not: {verdictState.reason}
                </p>
            )}
            <div className="flex flex-col gap-1">
                <span className="text-label">Given by</span>
                <ul className="flex flex-col gap-1 text-xs text-text-muted">
                    {verdict.attestations.map((attestation) => (
                        <li
                            key={attestation.author}
                            className="flex min-w-0 flex-col"
                        >
                            <span className="break-all text-text">
                                {authorLabel(attestation)}
                                {attestation.deploymentKind === "local" &&
                                    " · local"}
                                {dateLabel(attestation.createdAt) &&
                                    ` · ${dateLabel(attestation.createdAt)}`}
                            </span>
                            {attestation.note && (
                                <span className="break-words">
                                    “{attestation.note}”
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            </div>
            {botPick && (
                <p className="break-words text-xs text-text-disabled">
                    The Bot played: {botPick}
                </p>
            )}
            <code className="break-all text-[10px] text-text-disabled">
                {verdict.verdictId}
            </code>
        </article>
    );
}
