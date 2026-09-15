import type { ReviewPosition } from "@convex/verdictReview";
import {
    answerLetter,
    answerReading,
    positionHeadline,
} from "./verdict-review-model";

/** One position in the review list: its status, where in the game it is, and
 *  what each answer says — enough to pick the one to open. */
export default function VerdictPositionRow({
    position,
    onOpen,
}: {
    position: ReviewPosition;
    onOpen: () => void;
}) {
    const contested = position.status === "contested";
    return (
        <li>
            <button
                type="button"
                data-testid="verdict-position-row"
                onClick={onOpen}
                className="flex w-full min-w-0 flex-col gap-1 rounded-sm border border-border-subtle/40 p-3 text-left transition-colors hover:border-border-accent"
            >
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span
                        className={`text-xs font-semibold ${
                            contested
                                ? "text-danger-strong"
                                : "text-signal-self"
                        }`}
                    >
                        {contested ? "Contested" : "Resolved"}
                    </span>
                    <span className="text-xs text-text-muted">
                        {positionHeadline(position)}
                    </span>
                </span>
                <ul className="flex flex-col gap-0.5 text-sm text-text">
                    {position.verdicts.map((verdict, index) => {
                        const reading = answerReading(verdict.judgement);
                        return (
                            <li key={verdict.verdictId} className="break-words">
                                {answerLetter(index)} — {reading.kind}:{" "}
                                {reading.moves.join(", ")}
                            </li>
                        );
                    })}
                </ul>
            </button>
        </li>
    );
}
