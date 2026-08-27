import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";

export interface BottomSheetProps {
    open: boolean;
    onClose: () => void;
    /** Title row text, and the dialog's accessible name. */
    title: string;
    /** Scrolling body. */
    children: ReactNode;
    /** Optional pinned footer (a CTA row). Sits OUTSIDE the scrolling body so
     *  it stays reachable however long the body is — a flex sibling, never
     *  `position: sticky` (the shell's sticky census, issue #2274, is a
     *  registry of elements pinned to a scroller, and a sheet has no business
     *  being in it). */
    footer?: ReactNode;
    /** Marker attribute for probes/tests, e.g. `"data-basics-sheet"`. */
    marker?: string;
    /** Extra classes on the panel (not the scrim). */
    className?: string;
}

/**
 * The app's ONE modal bottom sheet with a free-form content slot (issue #2585).
 *
 * Extracted from `DeckBasicsSheet` (issue #2584), which was the second bespoke
 * sheet in the tree and is now the first caller of this one. The other two
 * overlay primitives cover different shapes and are deliberately NOT this:
 *
 *  - `ui/action-sheet.tsx` — modal bottom sheet too, but ITEM-LIST shaped
 *    (`ActionSheetItem[]`). A list of verbs, not a panel of controls.
 *  - `ui/dialog.tsx` / `ui/game-dialog.tsx` — centred modals, not edge-anchored.
 *
 * Properties worth keeping when editing:
 *
 *  - **Portaled to `document.body`.** The deckbuilder's phone layout is a fixed
 *    column of `overflow-hidden` boxes (issue #2584); a sheet rendered inside it
 *    would be clipped by whichever pane happened to host it.
 *  - **Unmounted when closed**, not `display: none` — a hidden panel leaves its
 *    controls in the document at zero size, which is both a dead tab stop and
 *    what the browser probe counts as a `zero`-size control.
 *  - **`max-h-[70dvh]` with the BODY, not the panel, doing the scrolling**, so a
 *    footer CTA never scrolls out of reach.
 */
export default function BottomSheet({
    open,
    onClose,
    title,
    children,
    footer,
    marker,
    className,
}: BottomSheetProps) {
    // Escape closes, from anywhere — the sheet is modal, so the key belongs to
    // it wherever focus happens to sit. Bound only while open.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    if (!open) return null;
    return createPortal(
        <div
            {...(marker ? { [marker]: "" } : {})}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="z-modal modal-scrim fixed inset-0 flex items-end"
            onClick={onClose}
        >
            <div
                className={cn(
                    // v4 (ADR 0103 §5, issue #2731): the hairline frame's top
                    // edge, matching `ActionSheet`'s re-skin, instead of the
                    // legacy accent border.
                    "flex max-h-[70dvh] w-full flex-col rounded-t-lg border-t border-[var(--hairline)] bg-surface pb-[max(0.5rem,env(safe-area-inset-bottom))]",
                    className
                )}
                onClick={(e) => e.stopPropagation()}
            >
                {/* The grip (ADR 0103 §5 — "the touch Action Sheet and bottom
                    sheets get the grip"). `BottomSheet` had none; `ActionSheet`
                    already carries the same `w-10 h-1` bar. */}
                <div className="flex shrink-0 justify-center pt-2">
                    <div className="w-10 h-1 rounded-full bg-[var(--hairline-strong)]" />
                </div>
                <div className="flex shrink-0 items-center justify-between px-3 pt-1">
                    <span className="text-display text-sm text-parchment">
                        {title}
                    </span>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={`Close ${title.toLowerCase()}`}
                        style={{
                            minHeight: "var(--control-h)",
                            minWidth: "var(--control-h)",
                        }}
                        className="flex items-center justify-center rounded-full text-text-muted hover:text-parchment"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
                {footer && <div className="shrink-0">{footer}</div>}
            </div>
        </div>,
        document.body
    );
}
