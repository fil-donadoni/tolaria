import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import BuilderPile from "~/components/lobby/deck-builder/builder-pile";
import { columnDropId } from "~/components/limited/limitedDraftDrag";
import type { DeckColumn } from "~/components/lobby/deckGrouping";

/**
 * One fixed Maindeck column of the limited deckbuilder (issue #1575) — a
 * `useDroppable` drop target (a numbered Mana-Value column or the Lands
 * column, sharing the draft Pool's `columnDropId` identity) wrapping the
 * shared `BuilderPile` so the card rendering, drag payloads (`kind: "main"`)
 * and click-to-sideboard gesture stay identical to the pre-#1575 surface.
 * Always rendered — even empty — so every column is a stable drop target for
 * a manual column override (mirrors the draft Pool's `LimitedPoolPile`).
 */
export default function PoolDeckbuilderColumn({
    column,
    onRemove,
}: {
    column: DeckColumn;
    /** Move one copy out of the Maindeck (click on a card, or the shared
     *  `BuilderPile`'s remove affordance) — the Sideboard direction. */
    onRemove: (cardId: string) => void;
}) {
    const { ref, isDropTarget } = useDroppable({
        id: columnDropId(column.column),
    });
    return (
        <div
            ref={ref}
            data-column={String(column.column)}
            className={cn(
                "shrink-0 rounded-sm p-1 transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <BuilderPile
                label={column.label}
                cards={column.cards}
                zone="main"
                onRemove={onRemove}
            />
        </div>
    );
}
