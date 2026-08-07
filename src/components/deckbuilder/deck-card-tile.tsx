import { useDraggable } from "@dnd-kit/react";
import type { ColumnId } from "@convex/deckLayout";
import { cn } from "~/lib/utils";
import { pileCardTop } from "~/lib/card-layout";
import CardImage from "~/components/cards/card-image";
import FeaturedCardButton from "~/components/lobby/deck-builder/featured-card-button";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import DeckCardMoveMenu, {
    type DeckCardMoveMenuColumn,
} from "./deck-card-move-menu";

/** The ONE deckbuilder card tile (issue #1581, re-homed here by #1632) — a
 *  single draggable + clickable card face rendered by EVERY zone surface:
 *  the Constructed Maindeck/Sideboard, the Limited build view's, and the
 *  draft-time Pool's. It replaced the forked tiles (`LimitedPoolCardTile` /
 *  `BuilderPile`'s inner `DraggableCard`); it lived under
 *  `components/limited/` until the draft Pool stopped having a column
 *  implementation of its own (#1632), which left the last file in that
 *  directory importing it with none.
 *
 *  Surface-specific concerns are props, not sibling components: the drag
 *  identity/payload (`dragId` / `dragData`), the gesture callbacks, and the
 *  tooltip. Every card renders as one member of an overlaid pile, so
 *  `stackIndex` is always set and the tile is `absolute`-positioned at its
 *  staggered `top`. */
export interface DeckCardTileProps {
    /** Registry Card ID — the card face to render. */
    cardId: string;
    /** dnd-kit draggable id (unique within the surface's DragDropProvider). */
    dragId: string;
    /** Drag payload the surface's `onDragEnd` reads to resolve the move. One
     *  shape across every surface: the `cardId`-keyed `CardDragData`, whose
     *  optional `pinKey` names the physical COPY being dragged (issue #1626 —
     *  the draft Pool's `poolIndex`, stringified). */
    dragData: CardDragData;
    /** Tooltip; also the queryable handle tests match (`Remove <name> …`). */
    title: string;
    /** Fired on a plain click — the primary tap gesture (move zone / toggle). */
    onClick: () => void;
    /** Fired on double-click. Every current surface omits it — the click
     *  handlers are idempotent, so a double-click already resolves as the same
     *  move twice — but it stays a prop rather than being dropped, because a
     *  tile is the one place a distinct double-click gesture could be bound. */
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
    /** "Move to…" menu (issue #1633): lists this Zone's Columns and pins the
     *  card to whichever is picked — the touch-friendly analogue of a drag,
     *  since a precise drop into a narrow column is not a realistic touch
     *  gesture. Presence renders the affordance; absent on Sideboard tiles
     *  (whose pane has no Columns to pin into) and wherever the host omits
     *  `onPin` (`DeckZoneSurface`). */
    moveMenu?: {
        columns: readonly DeckCardMoveMenuColumn[];
        onSelect: (columnId: ColumnId) => void;
    };
}

export default function DeckCardTile({
    cardId,
    dragId,
    dragData,
    title,
    onClick,
    onDoubleClick,
    stackIndex,
    isFeatured,
    onSetFeatured,
    moveMenu,
}: DeckCardTileProps) {
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
            {moveMenu && (
                <DeckCardMoveMenu
                    // The plain card name already rides on the drag payload
                    // (`dragData.cardName`) — `title` is the tooltip's fuller
                    // "Remove <name> (drag to move zone)" sentence, wrong shape
                    // for "Move <name> to…".
                    cardName={dragData.cardName}
                    columns={moveMenu.columns}
                    onSelect={moveMenu.onSelect}
                />
            )}
        </div>
    );
}
