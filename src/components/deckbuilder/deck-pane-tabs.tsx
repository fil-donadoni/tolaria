import type { DeckPane } from "./deckPanes";
import DeckPaneTab from "./deck-pane-tab";

/**
 * The phone PANE TABS (issue #2584, PRD #2405 slice 5, ADR 0101).
 *
 * One `DeckPaneTab` per pane of {@link DeckPane} (that component owns the
 * count, the drop target and the drop-id contract).
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
