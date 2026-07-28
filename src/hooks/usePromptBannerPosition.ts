import type { CSSProperties } from "react";
import { useDraggable, type DragHandlers } from "./useDraggable";
import { useIsPortrait } from "./useIsPortrait";

const NOOP_DRAG_HANDLERS: DragHandlers = {
    onPointerDown: () => {},
    onPointerMove: () => {},
    onPointerUp: () => {},
    onClickCapture: () => {},
};

export type PromptBannerPosition = {
    /** Class list for the OUTER positioning `div` — append any per-banner
     *  extras (e.g. `pointer-events-none`) rather than replacing it. */
    outerClassName: string;
    /** Inline style for the OUTER `div` (the drag-offset transform on
     *  desktop; empty in portrait — portrait is pinned, not draggable). */
    outerStyle: CSSProperties;
    /** Extra class(es) for the INNER drag-handle `div` — append to the
     *  existing `"cursor-move select-none"` (etc.) rather than replacing. */
    innerClassName: string;
    /** Spread onto the INNER drag-handle `div`. No-ops in portrait so a
     *  touch drag never fights the tap-to-act gesture and the banner stays
     *  pinned in its safe top slot. */
    dragHandlers: DragHandlers;
};

/**
 * Shared positioning for the small "priority/choice" prompt banners (payment,
 * mulligan, sacrifice, target-selection, attack-mana-tax, pending-choice —
 * issue #1762). Every one of them previously hardcoded the identical
 * `absolute top-1/2 left-1/2` + `useDraggable` recipe, which centers the
 * banner on the BOARD by default — exactly where a player needs to click
 * (a creature to target, a permanent to sacrifice/tap) in a narrow portrait
 * layout with no room to drag it out of the way first.
 *
 * - **Desktop / landscape** (`useIsPortrait` false): unchanged — centered on
 *   the board, freely draggable.
 * - **Portrait** (`useIsPortrait` true, ≤767px): pinned to a safe-area-aware
 *   strip near the TOP of the viewport instead of the center, width-capped
 *   so the longest prompt copy wraps rather than overflowing or drifting
 *   over the bottom controls. Dragging is disabled (a no-op handler set) —
 *   there is no board space to drag INTO on a phone, and a touch-drag would
 *   otherwise fight the tap-to-act gesture.
 */
export function usePromptBannerPosition(): PromptBannerPosition {
    const isPortrait = useIsPortrait();
    const { offset, dragHandlers } = useDraggable();

    if (isPortrait) {
        return {
            outerClassName:
                "fixed inset-x-0 top-[max(env(safe-area-inset-top),0.5rem)] z-modal flex justify-center px-3",
            outerStyle: {},
            innerClassName: "w-full max-w-[22rem] min-w-0",
            dragHandlers: NOOP_DRAG_HANDLERS,
        };
    }

    return {
        outerClassName: "absolute top-1/2 left-1/2 z-modal",
        outerStyle: {
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
        },
        innerClassName: "",
        dragHandlers,
    };
}
