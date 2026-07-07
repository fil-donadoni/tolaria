import type { ReactNode } from "react";
import { useElementSize } from "~/hooks/useElementSize";
import {
    CARD_WIDTH,
    CARD_HEIGHT,
    mirrorVertical,
    type Placement,
} from "~/lib/board-layout";
import { useZoneAnchorPublisher } from "~/hooks/useZoneAnchorPublisher";
import type { AnchorKind } from "~/hooks/arrowAnchorContext";
import SpatialSlot from "./spatial-slot";

/** One placeable card slot: a stable key and the node to render inside it. */
export type SpatialItem = {
    key: string;
    node: ReactNode;
};

type SpatialZoneProps = {
    items: SpatialItem[];
    /** Produces one {@link Placement} per item from the measured container size.
     *  This is the single source of truth for card positions — the same data
     *  anchors target arrows (PRD #249, #257). */
    layout: (count: number, width: number, height: number) => Placement[];
    /** Explicit per-item placements that OVERRIDE {@link layout}. The hand passes
     *  these while a card is being drag-reordered so it can open a gap at the drop
     *  target without touching the item array (PRD #249, drag-reorder v2). One
     *  entry per item, in item order; still mirrored for the opponent's side. When
     *  omitted the zone computes placements from `layout` as usual. */
    placements?: Placement[];
    /** Mirror placements vertically (opponent's side reuses the viewer math). */
    mirror?: boolean;
    /** Base card width/height in px (defaults to the shared card footprint). */
    cardWidth?: number;
    cardHeight?: number;
    /** When set, each item's placement center is published to the arrow-anchor
     *  registry under this kind (keyed by the item id), so SVG target arrows
     *  derive their endpoints from the same layout placements that position the
     *  cards (#257). Battlefield zones pass `"permanent"`. */
    anchorKind?: AnchorKind;
    /** Let cards paint outside the zone box instead of clipping them. The hand
     *  zone uses this so a card lifted during a drag-to-commit stays visible
     *  above the band rather than being clipped by `overflow-hidden` (#271,
     *  fix 4). Defaults to clipped. */
    overflowVisible?: boolean;
    /** The slot id whose reflow spring should be disabled (it snaps straight to
     *  its placement). The hand passes the currently-dragged card so its slot
     *  lands on each reordered placement instantly while its neighbours spring —
     *  the card's own lift then keeps it pinned under the pointer (no drift). */
    snapSlotId?: string | null;
    className?: string;
    "data-testid"?: string;
};

/** Absolutely-positions a zone's cards from shared pure layout output. Measures
 *  its own box, asks the supplied `layout` for per-card placements, and hands
 *  each placement to an animated {@link SpatialSlot} keyed by the item's stable
 *  id. The slot springs to its placement on reflow and animates across zone
 *  boundaries via shared-layout identity (#252). DOM-only view layer: it renders
 *  whatever node each item carries (reused card components), so the GRE boundary
 *  is untouched (#251). */
export default function SpatialZone({
    items,
    layout,
    placements: placementsOverride,
    mirror = false,
    cardWidth = CARD_WIDTH,
    cardHeight = CARD_HEIGHT,
    anchorKind,
    overflowVisible = false,
    snapSlotId,
    className,
    "data-testid": testId,
}: SpatialZoneProps) {
    const { ref, size } = useElementSize<HTMLDivElement>();
    const width = size.width || 0;
    const height = size.height || 0;

    let placements = placementsOverride ?? layout(items.length, width, height);
    if (mirror) {
        placements = placements.map((p) => mirrorVertical(p, height));
    }

    // Publish each item's placement center (in board-root coordinates) to the
    // arrow-anchor registry. Zone-local placements + the zone's static offset
    // within the board = the same source of truth that positions the cards, so
    // arrows never sample the moving DOM (#257).
    useZoneAnchorPublisher({
        kind: anchorKind,
        zoneRef: ref,
        items,
        placements,
        width,
        height,
    });

    return (
        <div
            ref={ref}
            className={`absolute inset-0 ${
                overflowVisible ? "overflow-visible" : "overflow-hidden"
            } ${className ?? ""}`}
            data-testid={testId}
        >
            {items.map((item, i) => {
                const p = placements[i];
                // Before the first measurement the container is 0×0 and the
                // layout collapses; place the slot at the origin rather than
                // stacking everything off-screen.
                const placed = p ?? { x: 0, y: 0, rotation: 0, scale: 1 };
                return (
                    <SpatialSlot
                        key={item.key}
                        slotId={item.key}
                        placement={placed}
                        cardWidth={cardWidth}
                        cardHeight={cardHeight}
                        snap={item.key === snapSlotId}
                    >
                        {item.node}
                    </SpatialSlot>
                );
            })}
        </div>
    );
}
