import { Maximize2 } from "lucide-react";
import type { PendingChoice } from "~/types/game";
import { useMinimizedChoice } from "~/hooks/useMinimizedChoice";
import { usePromptBannerPosition } from "~/hooks/usePromptBannerPosition";
import { pendingChoiceLabel } from "~/lib/pending-choice-labels";

/** Collapsed stand-in for a minimized blocking choice dialog (issue #315).
 *  Rendered on the board while the chooser has minimized the prompt to
 *  inspect the battlefield. A pulsing accent badge so the player cannot
 *  forget that play is blocked on a Pending Choice (CR 608.2). Clicking it
 *  restores the full dialog with any buffered selection intact — restore is
 *  a pure view toggle (`useMinimizedChoice`), so it does not touch the buffer
 *  or the submission flow.
 *
 *  Positioned via the shared {@link usePromptBannerPosition} (issue #1762
 *  review — this badge used to hardcode the same `absolute top-1/2
 *  left-1/2` dead-center recipe the other prompt banners did, exactly where
 *  a portrait player minimizes the dialog TO reach: a creature to target, a
 *  permanent to sacrifice/tap). Desktop is unchanged (dead center, though the
 *  badge itself never actually drags — its whole clickable area IS the drag
 *  handle, and `useDraggable` never starts a drag from a `button` target).
 *  Portrait: **always** `pinned: true` (review fixup on #1813/#1823) — never
 *  the dynamic `pendingChoiceRequiresBoardTap(choice)` branch the full dialog
 *  uses. Minimizing exists SPECIFICALLY to free up the board (see this
 *  docstring's own opening line) for whatever the player needs to tap next —
 *  a centered badge defeats that purpose for EVERY choice, not just the ones
 *  requiring a board tap: it still renders `w-full max-w-[22rem]
 *  pointer-events-auto`, a 352px-wide clickable target sitting dead center of
 *  the board, which reopens the full dialog on a tap meant for a card
 *  underneath. The full dialog can legitimately center (nothing to click
 *  behind an unminimized modal the player is actively reading), but the
 *  whole point of THIS collapsed badge is to get out of the way. */
export default function MinimizedChoiceIndicator({
    choice,
}: {
    choice: PendingChoice;
}) {
    const { restore } = useMinimizedChoice();
    const label = pendingChoiceLabel(choice.kind);
    const { outerClassName, outerStyle, innerClassName, dragHandlers } =
        usePromptBannerPosition({ pinned: true });

    return (
        <div className={outerClassName} style={outerStyle}>
            <button
                type="button"
                onClick={restore}
                aria-label={`Restore choice dialog: ${label}`}
                {...dragHandlers}
                className={`inline-flex items-center justify-center gap-2 rounded-sm border border-accent bg-accent-soft px-4 py-2 font-beleren text-sm tracking-wide text-accent-strong shadow-[0_0_30px_rgba(200,160,96,0.35)] animate-pulse hover:bg-accent-soft/80 hover:animate-none transition-colors cursor-pointer ${innerClassName}`.trim()}
            >
                <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-strong opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-strong" />
                </span>
                <span>{label} — pending</span>
                <Maximize2 className="h-3.5 w-3.5 opacity-80" />
            </button>
        </div>
    );
}
