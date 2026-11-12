import { useArrowHighlight } from "~/hooks/arrowHighlightContext";

/** Pointer handlers that seed the arrow hover channel with `nodeId` while the
 *  element is hovered (issue #9326: hovering a targeted zone pile focuses
 *  every relationship pointing into it). Empty outside an
 *  `ArrowHighlightProvider` (the classic board, tests) — a no-op spread. */
export function useArrowNodeHover(nodeId: string): {
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
} {
    const setSeed = useArrowHighlight()?.setSeed;
    if (!setSeed) return {};
    return {
        onPointerEnter: () => setSeed({ nodeId }),
        onPointerLeave: () => setSeed(null),
    };
}
