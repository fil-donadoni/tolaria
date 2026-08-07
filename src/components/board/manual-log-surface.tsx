import { useEffect } from "react";
import type { Id } from "@convex/_generated/dataModel";
import ManualLog from "./manual-log";

/** The Manual Game's collapsed log surface (issue #2172). Replaces the two
 *  shapes the log used to take: a permanently docked `w-80` right rail on
 *  desktop/landscape (`flex … shrink-0` sibling of the board — it subtracted
 *  its width from every board layout permanently, whether or not anyone was
 *  reading it) and a full-screen overlay behind a bare button in portrait.
 *  Both are gone: the log is now ONE overlay, collapsed by default in every
 *  viewport mode, opened from the controller's "Log" action
 *  (`manual-controller-actions.ts`) and closed from here.
 *
 *  `ManualLog` itself is untouched — its `usePaginatedQuery` subscription and
 *  its own `w-80 shrink-0` panel geometry are reused verbatim. This component
 *  only decides WHETHER that panel mounts and WHERE: an absolute overlay
 *  anchored to the right edge, with a dismissible backdrop.
 *
 *  Rendered as a DOM SIBLING of the board's `<main data-manual-board>`
 *  (`manual-board-view.tsx`), not a descendant — load-bearing, not
 *  cosmetic. `useManualDrag`'s `isOverBoard` check answers "was this drag
 *  release inside `[data-manual-board]`?" via `Element.closest`; nesting this
 *  surface inside `<main>` would make a release over the log panel itself
 *  read as "over the board" and wrongly arm the drag's click-swallow against
 *  this surface's own Close button. Staying a sibling keeps the log exactly
 *  as invisible to that check as the old rail was
 *  (`manual-drag-lifecycle.test.tsx`). */
export default function ManualLogSurface({
    gameId,
    open,
    onClose,
}: {
    gameId: Id<"games">;
    open: boolean;
    onClose: () => void;
}) {
    useEffect(() => {
        if (!open) return;
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            data-manual-log-surface
            className="absolute inset-0 z-modal flex justify-end"
        >
            {/* Dimmed backdrop — tap to dismiss, same convention as the
             *  portrait phase sheet (`controller-phase-sheet.tsx`). */}
            <button
                type="button"
                aria-label="Close log"
                onClick={onClose}
                className="absolute inset-0 bg-black/50"
            />
            <div className="relative flex h-full max-w-full flex-col items-end">
                <button
                    type="button"
                    onClick={onClose}
                    className="m-2 self-end rounded-lg bg-black/60 p-2 text-xs text-text-muted shadow-lg transition-colors hover:bg-black/80"
                >
                    Close
                </button>
                <div className="min-h-0 flex-1">
                    <ManualLog gameId={gameId} />
                </div>
            </div>
        </div>
    );
}
