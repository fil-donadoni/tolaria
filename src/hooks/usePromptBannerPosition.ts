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
 * - **Portrait** (`useIsPortrait` true, ≤767px): the default flipped in
 *   issue #1813 — most prompts (payment/mulligan confirmation, option picks,
 *   yes/no choices…) have nothing on the board for the player to tap, so
 *   pinning them to a top strip just wastes the vertically-centered screen
 *   real estate a phone has for a modal-style prompt. They now render
 *   **vertically (and horizontally) centered**, matching the desktop
 *   composition minus the drag offset. The **`pinned: true`** override keeps
 *   the ORIGINAL issue #1762 behavior — a safe-area-aware strip below the
 *   opponent's nameplate/life indicator (`board-player.tsx`, anchored
 *   `top-1`) — reserved for a prompt whose interaction genuinely requires
 *   tapping the mid-board (target selection, a sacrifice/payment leg that
 *   routes clicks to battlefield permanents): centering THOSE would put the
 *   panel directly on top of the permanents the player must tap. Reuses the
 *   SAME `top-24` offset `combat-panels.tsx` already parks its
 *   declare-attackers dock at for this exact reason, plus the safe-area
 *   inset on top so a notched device clears the dock even further.
 *   Width-capped so the longest prompt copy wraps rather than overflowing or
 *   drifting over the bottom controls, in EITHER portrait variant. Dragging
 *   is disabled in both (a no-op handler set) — there is no board space to
 *   drag INTO on a phone, and a touch-drag would otherwise fight the
 *   tap-to-act gesture, regardless of where the banner is anchored.
 *
 * Every branch's outer box is `pointer-events-none` with the inner box
 * `pointer-events-auto` (issue #1762 review) — the outer box's own
 * bounding box is bigger than the visible panel (both portrait variants
 * span the full viewport via `flex` centering so long copy can still center
 * itself; the desktop box is transform-centered from a top-left anchor), so
 * left as click-through-by-default it would otherwise swallow board taps in
 * the empty gutter beside the panel. Re-enabling on the inner box keeps the
 * panel itself (and everything inside it) fully interactive.
 */
export function usePromptBannerPosition(
    options: {
        /** Keep the original top-pinned strip on portrait instead of the
         *  #1813 default (vertically centered) — for a prompt whose own
         *  interaction requires the player to tap something on the
         *  mid-board (target selection; a sacrifice/payment leg that routes
         *  clicks to battlefield permanents) that a centered panel would
         *  otherwise cover. No-op on desktop/landscape — always centered
         *  there regardless. */
        pinned?: boolean;
    } = {}
): PromptBannerPosition {
    const isPortrait = useIsPortrait();
    const { offset, dragHandlers } = useDraggable();

    if (isPortrait) {
        if (options.pinned) {
            return {
                outerClassName:
                    "fixed inset-x-0 top-[calc(6rem+env(safe-area-inset-top))] z-modal flex justify-center px-3 pointer-events-none",
                outerStyle: {},
                innerClassName:
                    "w-full max-w-[22rem] min-w-0 pointer-events-auto",
                dragHandlers: NOOP_DRAG_HANDLERS,
            };
        }

        return {
            // `z-banner`, not `z-modal` (issue #1813/#1823 review fixup round
            // 2): this centered variant shares the board with the portrait
            // stack chip / opened stack panel (`--z-chip`, `BoardPortraitChips`
            // / `GameStack`'s `elevated` prop) and a real blocking modal
            // (`--z-modal` — trigger-order-prompt, mana-choice-picker, the
            // reveal overlays). It must lose to BOTH: the chip stays reachable
            // while this banner is open, and a blocking modal still owns the
            // whole screen including this banner's scrim area. See
            // `src/index.css`'s `--z-banner`/`--z-chip`/`--z-modal` comment for
            // the full 3-rung rationale. The `pinned` branch above is
            // deliberately UNCHANGED at `z-modal` — nothing paints over it.
            outerClassName:
                "fixed inset-0 z-banner flex items-center justify-center px-3 pointer-events-none",
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
