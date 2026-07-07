import { useCallback, useMemo, useRef, useState } from "react";
import type { Player } from "~/types/game";
import type { Placement } from "~/lib/board-layout";
import {
    clampDragOffsetX,
    handGapPlacements,
    moveItem,
    reconcileHandOrder,
    reorderIndexForDragX,
} from "~/lib/board-layout";
import { useElementSize } from "~/hooks/useElementSize";
import SpatialZone, { type SpatialItem } from "./spatial-zone";
import BoardCard from "./board-card";
import BoardHandCard from "./board-hand-card";

type BoardHandProps = {
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
    /** Base card footprint in px for this zone's slots. Defaults to the shared
     *  card size; the opponent's hand passes a smaller size so its backs read as
     *  a slimmer Arena-style sliver. */
    cardWidth?: number;
    cardHeight?: number;
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
 * Drag-reorder is DEFERRED-COMMIT (v2): while a card is dragged the item array
 * (and thus every card's DOM node) stays put — the new order is computed and
 * applied ONCE, on release. During the drag the dragged card floats under the
 * cursor and the rest of the hand opens a GAP at the drop target
 * ({@link handGapPlacements}), so the player sees exactly where the card will
 * land. Not touching the array mid-drag is what makes it fluid: the dragged
 * node never moves, so its pointer capture is never dropped (a live array
 * reorder silently killed the gesture after one slot), and the floating card is
 * driven purely by the fan math so it can't stutter.
 *
 * The opponent's hand is rendered through the same component but stays
 * presentational (no reorder, backs only).
 */
export default function BoardHand({
    player,
    interactive,
    layout,
    mirror = false,
    cardWidth,
    cardHeight,
    "data-testid": testId,
}: BoardHandProps) {
    // Measure the hand box so the drag math can use the SAME pure fan placements
    // that position the slots (the single source of truth), rather than reading
    // lagging DOM rects.
    const { ref: zoneRef, size } = useElementSize<HTMLDivElement>();

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
    // drop commits a reorder; reconciled against `serverIds` for the render order.
    const [viewOrder, setViewOrder] = useState<string[]>([]);
    const order = useMemo(
        () => reconcileHandOrder(viewOrder, serverIds),
        [viewOrder, serverIds]
    );

    // Active drag, committed only on release. `from` is the dragged card's index
    // in `order` at grab time; `order` is frozen for the whole drag (viewOrder
    // isn't touched until drop), so `from` stays valid. `dropIndex` is the slot
    // the card will land on — it drives BOTH the gap layout and the final commit.
    const [drag, setDrag] = useState<{ id: string; from: number } | null>(null);
    const [dropIndex, setDropIndex] = useState<number | null>(null);
    // Grab offset captured once per drag: the gap between the pointer and the
    // dragged card's center at grab time, so the card keeps its grab point under
    // the finger instead of snapping its center to the cursor.
    const dragGrab = useRef<{ id: string; offset: number } | null>(null);

    // Pure fan placements (zone-local) for the current order — the single source
    // of truth SpatialZone positions the slots from. mirror=false for the
    // interactive own hand, so these are also the on-screen positions (+ zone
    // left offset). Recomputed only when the count or the box size changes.
    const fan = useMemo(
        () => layout(order.length, size.width, size.height),
        [layout, order.length, size.width, size.height]
    );

    /** Fan slot centers in CLIENT-x (fan x + the zone's left offset). Pure w.r.t.
     *  the order within a render — no lagging DOM rects — so the floating card
     *  never stutters. The zone's own left offset is stable for the whole drag. */
    const clientCenters = useCallback((): Placement[] => {
        const zone = zoneRef.current;
        const left = zone ? zone.getBoundingClientRect().left : 0;
        return fan.map((p) => ({
            x: left + p.x,
            y: 0,
            rotation: 0,
            scale: 1,
        }));
    }, [fan, zoneRef]);

    /** On each drag move: record the drag (once) and the slot under the pointer.
     *  Nothing is committed here — only the presentation gap moves. */
    const onDragMove = useCallback(
        (id: string, pointerX: number) => {
            const from = order.indexOf(id);
            if (from < 0) return;
            if (!drag || drag.id !== id) setDrag({ id, from });
            const centers = clientCenters();
            if (centers.length === 0) return;
            setDropIndex(reorderIndexForDragX(centers, from, pointerX));
        },
        [order, drag, clientCenters]
    );

    /** Horizontal lift so the dragged card's center tracks the pointer. Its base
     *  slot is the drop-target slot (`handGapPlacements` parks it there), so the
     *  lift is `pointer − dropSlotCenter − grabOffset` and the rendered center
     *  lands on the pointer regardless of where the gap currently sits — a
     *  continuous float, never a per-slot step. {@link clampDragOffsetX} bounds it
     *  to the hand span so the card can never leave the viewport. */
    const dragTranslateX = useCallback(
        (id: string, pointerX: number): number => {
            const from = order.indexOf(id);
            if (from < 0) return 0;
            const centers = clientCenters();
            if (from >= centers.length) return 0;
            const rawDi =
                drag && drag.id === id && dropIndex !== null ? dropIndex : from;
            const di = rawDi >= 0 && rawDi < centers.length ? rawDi : from;
            let grab = dragGrab.current;
            if (!grab || grab.id !== id) {
                grab = { id, offset: pointerX - centers[from].x };
                dragGrab.current = grab;
            }
            const rawDx = pointerX - grab.offset - centers[di].x;
            return clampDragOffsetX(centers, di, rawDx);
        },
        [order, drag, dropIndex, clientCenters]
    );

    /** Commit the reorder ONCE, on release: move the dragged card to the drop
     *  slot (a no-op if it didn't move) and clear the per-drag bookkeeping. */
    const endDrag = useCallback(() => {
        if (drag && dropIndex !== null && dropIndex !== drag.from) {
            setViewOrder(moveItem(order, drag.from, dropIndex));
        }
        setDrag(null);
        setDropIndex(null);
        dragGrab.current = null;
    }, [drag, dropIndex, order]);

    // While dragging, open a gap at the drop slot without touching the item
    // array; otherwise let SpatialZone position the slots straight from `layout`
    // (no override), so nothing changes for the resting hand.
    const placements = useMemo<Placement[] | undefined>(() => {
        if (!drag || dropIndex === null) return undefined;
        const from = order.indexOf(drag.id);
        if (from < 0) return undefined;
        return handGapPlacements(fan, from, dropIndex);
    }, [drag, dropIndex, fan, order]);

    const canReorder = interactive && order.length > 1;
    const orderedItems: SpatialItem[] = useMemo(
        () =>
            order.map((id) => {
                const card = cardById.get(id) ?? null;
                return {
                    key: id,
                    node:
                        interactive && card ? (
                            <BoardHandCard
                                card={card}
                                onDragMove={
                                    canReorder
                                        ? (pointerX) => onDragMove(id, pointerX)
                                        : undefined
                                }
                                dragTranslateX={(pointerX) =>
                                    dragTranslateX(id, pointerX)
                                }
                                onDragEnd={endDrag}
                            />
                        ) : (
                            <BoardCard card={card} mirror={mirror} />
                        ),
                };
            }),
        [
            order,
            cardById,
            interactive,
            canReorder,
            onDragMove,
            dragTranslateX,
            endDrag,
            mirror,
        ]
    );

    return (
        <div ref={zoneRef} className="absolute inset-0">
            <SpatialZone
                items={orderedItems}
                layout={layout}
                placements={placements}
                mirror={mirror}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                overflowVisible={interactive}
                snapSlotId={drag?.id ?? null}
                data-testid={testId}
            />
        </div>
    );
}
