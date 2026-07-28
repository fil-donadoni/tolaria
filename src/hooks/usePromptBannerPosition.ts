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
    /** Class list for the OUTER positioning `div` — already carries
     *  `pointer-events-none` (the outer box is a full-bleed hit-test no-op;
     *  see the inner class below), so append any per-banner extras rather
     *  than replacing it. */
    outerClassName: string;
    /** Inline style for the OUTER `div` (the drag-offset transform on
     *  desktop; empty in portrait — portrait is pinned, not draggable). */
    outerStyle: CSSProperties;
    /** Extra class(es) for the INNER drag-handle `div` — already carries
     *  `pointer-events-auto` (re-enabling hit-testing for the actual panel,
     *  since the outer box disables it), so append to the existing
     *  `"cursor-move select-none"` (etc.) rather than replacing. */
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
 *   strip below the opponent's nameplate/life indicator (`board-player.tsx`,
 *   anchored `top-1` — a raw safe-area top offset landed the strip directly
 *   on top of it, hiding opponent life behind every banner, issue #1762
 *   review). Reuses the SAME `top-24` offset `combat-panels.tsx` already
 *   parks its declare-attackers dock at for this exact reason, plus the
 *   safe-area inset on top so a notched device clears the dock even
 *   further. Width-capped so the longest prompt copy wraps rather than
 *   overflowing or drifting over the bottom controls. Dragging is disabled
 *   (a no-op handler set) — there is no board space to drag INTO on a
 *   phone, and a touch-drag would otherwise fight the tap-to-act gesture.
 *
 * Both branches' outer box is `pointer-events-none` with the inner box
 * `pointer-events-auto` (issue #1762 review) — the outer box's own
 * bounding box is bigger than the visible panel (the portrait strip spans
 * the full viewport width via `flex justify-center` so long copy can still
 * center itself; the desktop box is transform-centered from a top-left
 * anchor), so left as click-through-by-default it would otherwise swallow
 * board taps in the empty gutter beside the panel. Re-enabling on the inner
 * box keeps the panel itself (and everything inside it) fully interactive.
 */
export function usePromptBannerPosition(): PromptBannerPosition {
    const isPortrait = useIsPortrait();
    const { offset, dragHandlers } = useDraggable();

    if (isPortrait) {
        return {
            outerClassName:
                "fixed inset-x-0 top-[calc(6rem+env(safe-area-inset-top))] z-modal flex justify-center px-3 pointer-events-none",
            outerStyle: {},
            innerClassName: "w-full max-w-[22rem] min-w-0 pointer-events-auto",
            dragHandlers: NOOP_DRAG_HANDLERS,
        };
    }

    return {
        outerClassName: "absolute top-1/2 left-1/2 z-modal pointer-events-none",
        outerStyle: {
            transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
        },
        innerClassName: "pointer-events-auto",
        dragHandlers,
    };
}
