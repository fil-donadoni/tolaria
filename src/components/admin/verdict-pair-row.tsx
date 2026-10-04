import type { PairListEntry } from "@convex/verdictReview";
import { Button } from "@/components/ui/button";
import { discriminantLabel, pairEntryLabel } from "./verdict-review-model";

/** One classified verdict in the pair list (issue #4801): what it is, the
 *  Discriminant it names, the move it is about, and a way to open it. */
export default function VerdictPairRow({
    entry,
    onOpen,
}: {
    entry: PairListEntry;
    onOpen: () => void;
}) {
    return (
        <li
            data-testid="verdict-pair-row"
            data-pair-kind={entry.kind}
            className="flex min-w-0 flex-col gap-1 rounded-sm border border-border-subtle/40 p-3"
        >
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span
                    className={`text-xs font-semibold ${
                        entry.kind === "incomplete"
                            ? "text-danger-strong"
                            : "text-signal-self"
                    }`}
                >
                    {pairEntryLabel(entry)}
                </span>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onOpen}
                >
                    Open
                </Button>
            </span>
            <span className="break-words text-sm text-text">
                {entry.answerKind === "right" ? "Right" : "Forbidden"}:{" "}
                {entry.moves.join(", ")}
            </span>
            {entry.discriminant && (
                <span className="break-words text-xs text-text-muted">
                    {discriminantLabel(entry.discriminant)}
                </span>
            )}
            {entry.why && (
                <span className="break-words text-xs text-text-disabled">
                    {entry.why}
                </span>
            )}
        </li>
    );
}
