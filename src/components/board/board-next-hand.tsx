import { useCallback, useMemo, useRef, useState } from "react";
import type { Player } from "~/types/game";
import type { Placement } from "~/lib/board-layout";
import {
    moveItem,
    reconcileHandOrder,
    reorderIndexForDragX,
} from "~/lib/board-layout";
import SpatialZone, { type SpatialItem } from "./spatial-zone";
import BoardNextCard from "./board-next-card";
import BoardNextHandCard from "./board-next-hand-card";

type BoardNextHandProps = {
    /** The hand owner. */
    player: Player;
    /** True for the viewer's own hand — its cards are interactive (click +
     *  drag-to-cast, #254) and drag-reorderable (#271, fix 2). The opponent's
     *  hand is presentational only and not reorderable. */
    interactive: boolean;
    /** Fan layout for the hand zone (shared math, #251). */
    layout: (count: number, width: number, height: number) => Placement[];
    /** Mirror placements onto the opponent's (top) side. */
    mirror?: boolean;
    "data-testid"?: string;
};

/** The hand zone for the spatial board (PRD #249).
 *
 * Owns the VIEW-ONLY presentation order of the hand (#271, fix 2): dragging a
 * card sideways snaps it to the slot under the drop position (Arena-style),
 * reordering only the layout — the server hand order and the GRE/zone are
 * untouched.
 *
 * The rendered order is DERIVED each render by reconciling the view-only
 * permutation against the authoritative server hand
 * ({@link reconcileHandOrder}): a pure sideways drag is honoured, while any real
 * hand change (draw / play / discard) folds in (dropping removed ids, appending
 * drawn ones) WITHOUT remounting — so existing card slots keep their identity
 * and their spring FLIP rather than jumping. No in-render `setState` and no
 * effect-driven resync are needed.
 *
 * The opponent's hand is rendered through the same component but stays
 * presentational (no reorder, backs only).
 */
export default function BoardNextHand({
    player,
    interactive,
    layout,
    mirror = false,
    "data-testid": testId,
}: BoardNextHandProps) {
    const zoneRef = useRef<HTMLDivElement>(null);

    // Authoritative hand, as instance ids (hidden backs get a stable handle).
    const serverIds = useMemo(
        () =>
            player.hand.map((c, i) => (c ? c.id : `hidden-${player.id}-${i}`)),
        [player.hand, player.id]
    );

    const cardById = useMemo(() => {
        const map = new Map<string, Player["hand"][number]>();
        player.hand.forEach((c, i) => {
            map.set(c ? c.id : `hidden-${player.id}-${i}`, c);
        });
        return map;
    }, [player.hand, player.id]);

    // The view-only permutation the player produced by dragging. Empty until a
    // drag reorders; reconciled against `serverIds` for the actual render order.
    const [viewOrder, setViewOrder] = useState<string[]>([]);
    const order = useMemo(
        () => reconcileHandOrder(viewOrder, serverIds),
        [viewOrder, serverIds]
    );

    /** Snap the dragged card (`draggedId`) to the slot under `pointerX` (client
     *  px). Reads the rendered slot centers so the snap matches what the player
     *  sees; pure {@link reorderIndexForDragX} picks the nearest slot. The result
     *  is stored as the new view-only permutation. */
    const reorderTo = useCallback(
        (current: string[], draggedId: string, pointerX: number) => {
            const zone = zoneRef.current;
            if (!zone) return;
            const from = current.indexOf(draggedId);
            if (from < 0) return;
            // Slot centers in client-x, in current presentation order.
            const centers: Placement[] = current.map((id) => {
                const slot = zone.querySelector<HTMLElement>(
                    `[data-card-slot="${CSS.escape(id)}"]`
                );
                if (!slot) return { x: 0, y: 0, rotation: 0, scale: 1 };
                const r = slot.getBoundingClientRect();
                return { x: r.left + r.width / 2, y: 0, rotation: 0, scale: 1 };
            });
            const to = reorderIndexForDragX(centers, from, pointerX);
            if (to === from) return;
            setViewOrder(moveItem(current, from, to));
        },
        []
    );

    const canReorder = interactive && order.length > 1;
    const orderedItems: SpatialItem[] = useMemo(
        () =>
            order.map((id) => {
                const card = cardById.get(id) ?? null;
                return {
                    key: id,
                    node:
                        interactive && card ? (
                            <BoardNextHandCard
                                card={card}
                                onDragMove={
                                    canReorder
                                        ? (pointerX) =>
                                              reorderTo(order, id, pointerX)
                                        : undefined
                                }
                            />
                        ) : (
                            <BoardNextCard card={card} />
                        ),
                };
            }),
        [order, cardById, interactive, canReorder, reorderTo]
    );

    return (
        <div ref={zoneRef} className="absolute inset-0">
            <SpatialZone
                items={orderedItems}
                layout={layout}
                mirror={mirror}
                overflowVisible={interactive}
                data-testid={testId}
            />
        </div>
    );
}
