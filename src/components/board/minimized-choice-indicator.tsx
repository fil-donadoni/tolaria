import { Maximize2 } from "lucide-react";
import type { PendingChoice } from "~/types/game";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";

/** Collapsed stand-in for a minimized blocking choice dialog (issue #315).
 *  Rendered on the board while the chooser has minimized the prompt to
 *  inspect the battlefield. A pulsing accent badge so the player cannot
 *  forget that play is blocked on a Pending Choice (CR 608.2). Clicking it
 *  restores the full dialog with any buffered selection intact — restore is
 *  a pure view toggle (`useMinimizedChoice`), so it does not touch the buffer
 *  or the submission flow. */
export default function MinimizedChoiceIndicator({
    choice,
}: {
    choice: PendingChoice;
}) {
    const { restore } = useMinimizedChoice();
    const label = pendingChoiceLabel(choice.kind);

    return (
        <button
            type="button"
            onClick={restore}
            aria-label={`Restore choice dialog: ${label}`}
            className="absolute top-1/2 left-1/2 z-100 -translate-x-1/2 -translate-y-1/2 inline-flex items-center gap-2 rounded-sm border border-accent bg-accent-soft px-4 py-2 font-beleren text-sm tracking-wide text-accent-strong shadow-[0_0_30px_rgba(200,160,96,0.35)] animate-pulse hover:bg-accent-soft/80 hover:animate-none transition-colors cursor-pointer pointer-events-auto"
        >
            <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-strong opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-strong" />
            </span>
            <span>{label} — pending</span>
            <Maximize2 className="h-3.5 w-3.5 opacity-80" />
        </button>
    );
}
