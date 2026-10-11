import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import { packSourceName } from "~/lib/limitedEventName";
import { limitedDraftPackProgress } from "~/lib/limited/limitedEventHero";
import { cn } from "~/lib/utils";

const STATE_LABEL = {
    done: "Done",
    current: "In play",
    upcoming: "Next",
} as const;

/** Draft progress per pack, plus how many cards the viewer has picked so far
 *  (PRD #5383, issue #5389). */
export default function LimitedEventDraftProgress({
    event,
    pickCount,
}: {
    event: LimitedEventView;
    /** The viewer's own picks so far; absent for a visitor. */
    pickCount: number | null;
}) {
    return (
        <section
            data-testid="draft-progress"
            className="flex flex-col gap-2 rounded-sm border border-border-subtle/40 bg-surface-elevated px-4 py-3"
        >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Draft progress
            </h3>
            <ol className="flex flex-col gap-1 text-sm">
                {limitedDraftPackProgress(event).map(({ index, state }) => (
                    <li
                        key={index}
                        data-pack-state={state}
                        className={cn(
                            "flex items-center justify-between gap-2",
                            state === "upcoming" && "text-text-muted"
                        )}
                    >
                        <span>
                            Pack {index + 1} ·{" "}
                            {packSourceName(event.packSlots[index])}
                        </span>
                        <span className="text-xs uppercase tracking-wide text-text-muted">
                            {STATE_LABEL[state]}
                        </span>
                    </li>
                ))}
            </ol>
            {pickCount !== null && (
                <p className="text-sm text-text-muted">
                    Your picks:{" "}
                    <span className="font-semibold text-text tabular-nums">
                        {pickCount}
                    </span>
                </p>
            )}
        </section>
    );
}
