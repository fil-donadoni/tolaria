import { useMemo, useRef } from "react";
import type { StackItem } from "~/types/game";
import { buildTargetArrows, emptyAnchorMap } from "~/lib/target-arrow-geometry";
import { useArrowAnchors } from "~/hooks/arrowAnchorContext";
import { useDomAnchorPublisher } from "~/hooks/useDomAnchorPublisher";

type BoardNextArrowsProps = {
    stack: StackItem[];
};

/** Arrow stroke colour — matches the amber used by the classic leader-line
 *  arrows for visual parity. */
const ARROW_COLOR = "rgba(245, 158, 11, 0.92)";

/**
 * SVG target-arrow layer for the spatial board (PRD #249, slice #257) —
 * replaces `leader-line` on `BoardNext`.
 *
 * Arrows connect each stack item to its targeted permanents / players / stack
 * items. Endpoints come from the {@link useArrowAnchors} registry: battlefield
 * permanents publish from the SAME shared layout placements that position the
 * cards (`useZoneAnchorPublisher`), while the discrete stack / player /
 * graveyard panels publish from their DOM rects ({@link useDomAnchorPublisher}).
 * Geometry recomputes whenever any anchor moves, so arrows stay glued to
 * continuously-animating cards with no reflow and no visible lag — the failure
 * mode `leader-line` (which sampled the DOM at an instant) exhibited under the
 * spring/tilt motion of the new board.
 *
 * Rendered as a single full-board overlay `<svg>` so paths share one coordinate
 * space (the board root); pointer events pass through to the cards beneath.
 */
export default function BoardNextArrows({ stack }: BoardNextArrowsProps) {
    const svgRef = useRef<SVGSVGElement>(null);
    const registry = useArrowAnchors();

    // Re-measure DOM anchors when the stack identity set changes (items added /
    // resolved) so newly-mounted stack/player/graveyard anchors are picked up.
    const stackKey = useMemo(() => stack.map((s) => s.id).join(","), [stack]);
    useDomAnchorPublisher(svgRef, ["stack", "player", "graveyard"], stackKey);

    const anchors = registry?.anchors ?? emptyAnchorMap();
    const arrows = useMemo(
        () => buildTargetArrows(stack, anchors),
        [stack, anchors]
    );

    return (
        <svg
            ref={svgRef}
            className="pointer-events-none absolute inset-0 z-[60] h-full w-full overflow-visible"
            aria-hidden
            data-testid="board-next-arrows"
        >
            <defs>
                <marker
                    id="board-next-arrowhead"
                    markerWidth="6"
                    markerHeight="6"
                    refX="4.5"
                    refY="3"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                >
                    <path d="M0,0 L6,3 L0,6 Z" fill={ARROW_COLOR} />
                </marker>
            </defs>
            {arrows.map((arrow) => (
                <path
                    key={arrow.key}
                    data-arrow-key={arrow.key}
                    d={arrow.path}
                    fill="none"
                    stroke={ARROW_COLOR}
                    strokeWidth={3}
                    strokeLinecap="round"
                    markerEnd="url(#board-next-arrowhead)"
                />
            ))}
        </svg>
    );
}
