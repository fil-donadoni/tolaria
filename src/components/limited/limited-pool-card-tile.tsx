import { useDraggable } from "@dnd-kit/react";
import type { LimitedPoolCard } from "@convex/limited/eventTypes";
import { cn } from "~/lib/utils";
import { pileCardTop } from "~/lib/card-layout";
import CardImage from "~/components/cards/card-image";
import type { PoolDragData } from "./limitedDraftDrag";

/**
 * One already-picked Pool card (ADR 0060, issue #1248): draggable (Pool ⇄
 * Sideboard, or between Mana-Value columns — a manual column override) AND
 * click/double-click both toggle Pool ⇄ Sideboard membership (single click
 * is the pre-#1248 gesture from #1247, kept for compatibility; double-click
 * is the gesture this issue's acceptance criteria name explicitly — both
 * fire the SAME callback, there is no "selection" concept for a Pool card,
 * only for a Booster card, see `LimitedDraftPackCard`).
 */
export default function LimitedPoolCardTile({
    poolIndex,
    card,
    sideboard,
    onToggleSideboard,
    stackIndex,
}: {
    poolIndex: number;
    card: LimitedPoolCard;
    /** Which side this tile is CURRENTLY rendered on — decides the toggle
     *  direction and the title copy. */
    sideboard: boolean;
    onToggleSideboard: () => void;
    /** Position in an overlaid deckbuilder-style pile (ADR 0060). When set,
     *  the tile renders `absolute` at the staggered `top` offset so only a
     *  sliver of each lower card shows; the topmost (visible) card reads as
     *  the primary target. Passed by both the mana-value columns
     *  (`LimitedPoolPile`) and the Sideboard column (`LimitedPoolSideboard`,
     *  issue #1574) — every Pool tile renders as a pile. */
    stackIndex?: number;
}) {
    const data: PoolDragData = {
        kind: "pool",
        poolIndex,
        cardId: card.cardId,
        cardName: card.cardName,
    };
    const { ref, isDragging } = useDraggable({
        id: `pool-${poolIndex}`,
        data,
    });
    const title = sideboard
        ? `Remove ${card.cardName} from the Sideboard (double-click, drag, or click)`
        : `Remove ${card.cardName} (double-click, drag, or click)`;

    const stacked = stackIndex !== undefined;
    return (
        <div
            ref={ref}
            role="button"
            tabIndex={0}
            title={title}
            onClick={onToggleSideboard}
            onDoubleClick={onToggleSideboard}
            style={stacked ? { top: pileCardTop(stackIndex) } : undefined}
            className={cn(
                "aspect-5/7 w-(--card-w) shrink-0 cursor-grab touch-none select-none outline-none transition hover:-translate-y-0.5 hover:z-10",
                stacked ? "absolute left-0" : "",
                isDragging ? "opacity-30" : ""
            )}
        >
            <CardImage card={{ id: card.cardId }} />
        </div>
    );
}
