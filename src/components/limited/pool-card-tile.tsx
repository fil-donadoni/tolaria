import { useDraggable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileCardTop } from "~/lib/card-layout";
import CardImage from "~/components/cards/card-image";
import FeaturedCardButton from "~/components/lobby/deck-builder/featured-card-button";
import type { DraftDragData } from "./limitedDraftDrag";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";

/** The drag payload a Pool tile carries — a `poolIndex`-keyed draft payload
 *  (`DraftDragData`) or a `cardId`-keyed deckbuilder payload (`CardDragData`).
 *  Each host constructs its own; the tile is agnostic. */
export type PoolTileDragData = DraftDragData | CardDragData;

/** The ONE Pool card tile (issue #1581) — a single draggable + clickable card
 *  face shared by BOTH the draft Pool and the limited deckbuilder, replacing
 *  the two forked tiles (`LimitedPoolCardTile` / `BuilderPile`'s inner
 *  `DraggableCard`). Phase-specific concerns are props, not sibling
 *  components: the drag identity/payload (`dragId` / `dragData` — a
 *  `poolIndex`-keyed `PoolDragData` in the draft, a `cardId`-keyed
 *  `CardDragData` in the deckbuilder), the gesture callbacks, and the tooltip.
 *  Every card renders as one member of an overlaid pile, so `stackIndex` is
 *  always set and the tile is `absolute`-positioned at its staggered `top`. */
export interface PoolCardTileProps {
    /** Registry Card ID — the card face to render. */
    cardId: string;
    /** dnd-kit draggable id (unique within the surface's DragDropProvider). */
    dragId: string;
    /** Drag payload the surface's `onDragEnd` reads to resolve the move. */
    dragData: PoolTileDragData;
    /** Tooltip; also the queryable handle tests match (`Remove <name> …`). */
    title: string;
    /** Fired on a plain click — the primary tap gesture (move zone / toggle). */
    onClick: () => void;
    /** Fired on double-click — the draft Pool binds the SAME toggle here so
     *  either gesture works; the deckbuilder omits it (single-click only). */
    onDoubleClick?: () => void;
    /** Position in the overlaid pile — the tile renders `absolute` at the
     *  staggered `top` so only a sliver of each lower card shows and the
     *  topmost reads as the primary target. */
    stackIndex?: number;
    /** This card is the deck's Featured Card (PRD #589, issue #599) — draws
     *  the persistent indicator ring. Constructed only; the Limited builder
     *  and the draft Pool leave it unset. */
    isFeatured?: boolean;
    /** Pick this card as the deck's Featured Card. Presence is what renders
     *  the affordance, so a surface with no Featured Card concept simply omits
     *  it. Set on the TOPMOST (visible) copy of a card only — a lower copy's
     *  button would sit behind the next card. */
    onSetFeatured?: () => void;
}

export default function PoolCardTile({
    cardId,
    dragId,
    dragData,
    title,
    onClick,
    onDoubleClick,
    stackIndex,
    isFeatured,
    onSetFeatured,
}: PoolCardTileProps) {
    const { ref, isDragging } = useDraggable({ id: dragId, data: dragData });
    const stacked = stackIndex !== undefined;
    return (
        <div
            ref={ref}
            role="button"
            tabIndex={0}
            title={title}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            style={stacked ? { top: pileCardTop(stackIndex) } : undefined}
            className={cn(
                "group aspect-5/7 w-(--card-w) shrink-0 cursor-grab touch-none select-none outline-none transition hover:-translate-y-0.5 hover:z-10",
                stacked ? "absolute left-0" : "relative",
                isDragging ? "opacity-30" : ""
            )}
        >
            <CardImage card={{ id: cardId }} />
            {/* A "removable" hover cue (parity with the pre-#1581 deckbuilder
                tile), keyed off the group so it only lights the hovered card. */}
            <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-danger-strong/70" />
            {isFeatured && (
                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-accent" />
            )}
            {onSetFeatured && (
                <FeaturedCardButton
                    isFeatured={!!isFeatured}
                    onSetFeatured={onSetFeatured}
                />
            )}
        </div>
    );
}
