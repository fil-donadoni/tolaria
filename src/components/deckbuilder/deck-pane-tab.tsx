import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import type { DeckPane } from "./deckPanes";

export interface DeckPaneTabProps {
    pane: DeckPane;
    /** This tab's pane is the one the strip has landed on. */
    active: boolean;
    onSelect: () => void;
}

/**
 * ONE tab of the phone pane strip (issue #2584) — a label, a live count, and a
 * dnd-kit DROP TARGET.
 *
 * Its own file for the project's one-component-per-file rule, and because the
 * `useDroppable` hook needs a component to live in: `DeckPaneTabs` renders the
 * tabs with a `.map`, which cannot call a hook. `DeckColumnPile` is the
 * existing precedent for the same shape.
 *
 * The drop is what makes a tab more than navigation: a long-press drag can move
 * a card to a pane that is entirely off screen, which on a 390px viewport is
 * the only way to reach the Sideboard without first swiping to it and losing
 * the card in hand. The drop id resolves through the SAME
 * `resolveDeckZoneDragAction` a drop on the pane itself does
 * (`deckZoneDrag.ts` § `TAB_PREFIX`).
 */
export default function DeckPaneTab({
    pane,
    active,
    onSelect,
}: DeckPaneTabProps) {
    const { ref, isDropTarget } = useDroppable({ id: pane.dropId });
    return (
        <button
            ref={ref}
            type="button"
            role="tab"
            aria-selected={active}
            data-deck-pane-tab={pane.id}
            onClick={onSelect}
            style={{ minHeight: "var(--control-h)" }}
            className={cn(
                "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 text-xs font-semibold transition",
                active
                    ? "bg-accent-soft/20 text-parchment"
                    : "text-text-muted hover:text-parchment",
                isDropTarget ? "ring-2 ring-inset ring-accent" : ""
            )}
        >
            <span className="truncate">{pane.label}</span>
            <span className="shrink-0 text-text-disabled">{pane.count}</span>
        </button>
    );
}
