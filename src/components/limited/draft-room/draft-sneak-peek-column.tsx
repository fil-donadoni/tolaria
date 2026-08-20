import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import DraftCardPile from "./draft-card-pile";
import DraftSelectionActions from "./draft-selection-actions";
import DraftStripDropZone from "./draft-strip-drop-zone";
import DraftSwipeChevron from "./draft-swipe-chevron";
import type { DraftPileCard } from "./draftPhonePanes";

/**
 * The LANDSCAPE sneak-peek column (issue #2588, ADR 0101 §6) — the pool
 * pane's leading 20% of the viewport, and what shows through while the player
 * is on the pack: "the picks as one Arena-style vertical pile, the Sideboard
 * count, the actions bar under it — Pick / → SB / Inspect for the selected
 * card; dropping on it picks".
 *
 * Same three jobs as the portrait strip (live tab, way in, drop target) in the
 * shape the wide-and-short axis affords, and the same two drop ids, so a drop
 * here and a drop there resolve through one function. The pile is
 * `aria-hidden` decoration over the counts (see `draft-card-pile.tsx`); the
 * counts themselves are text.
 */
export default function DraftSneakPeekColumn({
    picks,
    mainCount,
    sideCount,
    selected,
    actions,
    status,
    onOpenPool,
}: {
    picks: readonly DraftPileCard[];
    mainCount: number;
    sideCount: number;
    selected: { cardId: string; cardName: string } | null;
    actions: readonly EditingSurfaceAction[];
    /** The pack's own state line, shown when no card is selected. */
    status: React.ReactNode;
    onOpenPool: () => void;
}) {
    return (
        <div
            data-slot="draft-sneak-peek"
            className="flex w-[25%] shrink-0 flex-col border-l border-border-accent/40 bg-surface"
        >
            <DraftStripDropZone
                zone="maindeck"
                label={`Your pool, ${mainCount} cards — open it, or drop a card here to pick it`}
                onSelect={onOpenPool}
                className="min-h-0 flex-1 justify-start gap-1 py-1"
            >
                <span className="flex items-center gap-1 text-[11px] tracking-widest text-text-muted uppercase">
                    <DraftSwipeChevron direction="left" />
                    <span data-slot="draft-pool-count">Pool · {mainCount}</span>
                </span>
                <DraftCardPile
                    cards={picks}
                    emptyLabel="no picks yet"
                    className="min-h-0 flex-1"
                />
            </DraftStripDropZone>

            <DraftStripDropZone
                zone="sideboard"
                label={`Sideboard, ${sideCount} cards — drop a card here to pick it straight to the sideboard`}
                onSelect={onOpenPool}
                className="shrink-0 justify-center border-t border-border-subtle/40"
            >
                <span
                    data-slot="draft-sideboard-count"
                    className="text-[11px] tracking-widest text-text-muted uppercase"
                >
                    SB · {sideCount}
                </span>
            </DraftStripDropZone>

            {/* The actions bar UNDER the peek (ADR 0101 §6). Its own band, not
                part of either drop zone: a tap on `Pick` must pick, never
                scroll the pool into view. */}
            <div className="flex shrink-0 flex-col gap-1 border-t border-border-accent/40 p-1.5">
                {selected ? (
                    <DraftSelectionActions
                        cardId={selected.cardId}
                        cardName={selected.cardName}
                        actions={actions}
                        axis="column"
                    />
                ) : (
                    status
                )}
            </div>
        </div>
    );
}
