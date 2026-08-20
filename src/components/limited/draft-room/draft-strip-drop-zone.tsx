import { useDroppable } from "@dnd-kit/react";
import type { DeckZone } from "@convex/deckLayout";
import { cn } from "~/lib/utils";
import { draftStripDropId } from "../limitedDraftDrag";

/**
 * One half of a phone STRIP — a drop target that also navigates (issue
 * #2588, ADR 0101 §6).
 *
 * Its own file because `useDroppable` needs a component (the strips render
 * their halves inline, and a hook cannot be called in a branch), which is the
 * same reason `DeckPaneTab` exists next door. The drop id comes from
 * `limitedDraftDrag.ts`, so a drop here resolves through the SAME
 * `resolveDraftDragAction` a drop on the Pool pane itself does — the strip is
 * a second door onto one behaviour, never a second implementation of it.
 *
 * It is a `<button>`: on a phone the Pool pane is off screen, so the strip is
 * also the only way to REACH it, and that has to work for a tap, for a
 * keyboard, and for a screen reader — not only for a drag.
 */
export default function DraftStripDropZone({
    zone,
    label,
    onSelect,
    className,
    children,
}: {
    /** The Zone a card dropped here lands in — `"sideboard"` is the "pick
     *  straight to the Sideboard" half. */
    zone: DeckZone;
    /** Accessible name; the visible text is `children`. */
    label: string;
    onSelect: () => void;
    className?: string;
    children: React.ReactNode;
}) {
    const { ref, isDropTarget } = useDroppable({ id: draftStripDropId(zone) });
    return (
        <button
            ref={ref}
            type="button"
            data-slot="draft-strip-drop"
            data-zone={zone}
            data-drop-target={isDropTarget ? "true" : undefined}
            aria-label={label}
            onClick={onSelect}
            style={{ minHeight: "var(--control-h)" }}
            className={cn(
                "flex min-w-0 flex-col items-center gap-0.5 px-2 text-center transition",
                isDropTarget
                    ? "bg-accent-soft/30 ring-2 ring-inset ring-accent"
                    : "hover:bg-surface-elevated/40",
                className
            )}
        >
            {children}
        </button>
    );
}
