import type { ReactNode } from "react";
import { useElementSize } from "~/hooks/useElementSize";
import {
    CARD_WIDTH,
    CARD_HEIGHT,
    mirrorVertical,
    type Placement,
} from "~/lib/board-layout";

/** One placeable card slot: a stable key and the node to render inside it. */
export type SpatialItem = {
    key: string;
    node: ReactNode;
};

type SpatialZoneProps = {
    items: SpatialItem[];
    /** Produces one {@link Placement} per item from the measured container size.
     *  This is the single source of truth for card positions — the same data
     *  later anchors target arrows (PRD #249). */
    layout: (count: number, width: number, height: number) => Placement[];
    /** Mirror placements vertically (opponent's side reuses the viewer math). */
    mirror?: boolean;
    /** Base card width/height in px (defaults to the shared card footprint). */
    cardWidth?: number;
    cardHeight?: number;
    className?: string;
    "data-testid"?: string;
};

/** Absolutely-positions a zone's cards from shared pure layout output. Measures
 *  its own box, asks the supplied `layout` for per-card placements, and writes
 *  each one to a GPU `transform`. DOM-only view layer: it renders whatever node
 *  each item carries (reused card components), so the GRE boundary is untouched
 *  (#251). */
export default function SpatialZone({
    items,
    layout,
    mirror = false,
    cardWidth = CARD_WIDTH,
    cardHeight = CARD_HEIGHT,
    className,
    "data-testid": testId,
}: SpatialZoneProps) {
    const { ref, size } = useElementSize<HTMLDivElement>();
    const width = size.width || 0;
    const height = size.height || 0;

    let placements = layout(items.length, width, height);
    if (mirror) {
        placements = placements.map((p) => mirrorVertical(p, height));
    }

    return (
        <div
            ref={ref}
            className={`absolute inset-0 overflow-hidden ${className ?? ""}`}
            data-testid={testId}
        >
            {items.map((item, i) => {
                const p = placements[i];
                // Before the first measurement the container is 0×0 and the
                // layout collapses; render the slot off-screen rather than
                // stacking everything at the origin.
                const placed = p ?? { x: 0, y: 0, rotation: 0, scale: 1 };
                return (
                    <div
                        key={item.key}
                        data-card-slot={item.key}
                        className="absolute left-0 top-0 will-change-transform"
                        style={{
                            width: cardWidth,
                            height: cardHeight,
                            transform: `translate(${placed.x - cardWidth / 2}px, ${
                                placed.y - cardHeight / 2
                            }px) rotate(${placed.rotation}deg) scale(${placed.scale})`,
                        }}
                    >
                        {item.node}
                    </div>
                );
            })}
        </div>
    );
}
