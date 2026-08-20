import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import type { DeckPane } from "./deckPanes";

/** One tab. Split out only so the `useDroppable` hook has a component to live
 *  in — a `.map` cannot call a hook. */
function DeckPaneTab({
    pane,
    active,
    onSelect,
}: {
    pane: DeckPane;
    active: boolean;
    onSelect: () => void;
}) {
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

/**
 * The phone PANE TABS (issue #2584, PRD #2405 slice 5, ADR 0101).
 *
 * One tab per pane of {@link DeckPane}, each showing a live count and each
 * being a DROP TARGET. The drop is what makes the tab more than navigation: a
 * long-press drag can move a card to a pane that is entirely off screen, which
 * on a 390px viewport is the only way to reach the Sideboard without first
 * swiping to it and losing the card in hand.
 *
 * A tab's drop id resolves through the SAME `resolveDeckZoneDragAction` a drop
 * on the pane itself does (`deckZoneDrag.ts` § `TAB_PREFIX`), so the two can
 * never mean different things.
 *
 * Tapping a tab scrolls its pane into view rather than switching a rendered
 * branch: in portrait the panes are a snap-scroller (so this is a programmatic
 * swipe), and in landscape they are laid out side by side (so it is a scroll to
 * a pane that is already on the page). One behaviour, both arrangements.
 */
export default function DeckPaneTabs({
    panes,
    activeId,
    onSelect,
}: {
    panes: readonly DeckPane[];
    activeId: string | null;
    onSelect: (pane: DeckPane) => void;
}) {
    return (
        <div
            role="tablist"
            aria-label="Deck panes"
            data-deck-pane-tabs
            className="flex shrink-0 items-stretch gap-1 border-b border-border-subtle/30 bg-surface/60 px-2 py-1"
        >
            {panes.map((pane) => (
                <DeckPaneTab
                    key={pane.id}
                    pane={pane}
                    active={pane.id === activeId}
                    onSelect={() => onSelect(pane)}
                />
            ))}
        </div>
    );
}
