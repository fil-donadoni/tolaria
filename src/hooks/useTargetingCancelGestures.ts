import { useEffect, useRef } from "react";
import { isEditableTarget } from "~/lib/editable-target";

/** Overlays that own <kbd>Escape</kbd> / right-click themselves: while one is
 *  open the gesture is ITS dismissal, not the target choice's cancel. */
const OVERLAY_SELECTORS = [
    '[data-slot="dialog-content"]',
    '[data-slot="popover-content"]',
    '[data-slot="context-menu-content"]',
    '[data-slot="sheet-content"]',
].join(",");

/** Escape or right-click backs out of an open target choice (issue #9163,
 *  Arena parity). Capture phase + `stopPropagation`, so the board's Escape →
 *  pause menu (`usePauseMenuHotkey`, bubble phase) and a card's context menu
 *  do not fire on the same gesture. Attached only while `active`. */
export function useTargetingCancelGestures(
    active: boolean,
    cancel: () => void
): void {
    const cancelRef = useRef(cancel);
    useEffect(() => {
        cancelRef.current = cancel;
    }, [cancel]);

    useEffect(() => {
        if (!active) return;
        const overlayOpen = () => !!document.querySelector(OVERLAY_SELECTORS);
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (isEditableTarget(e.target) || overlayOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            cancelRef.current();
        };
        const onContextMenu = (e: MouseEvent) => {
            if (overlayOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            cancelRef.current();
        };
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("contextmenu", onContextMenu, true);
        return () => {
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("contextmenu", onContextMenu, true);
        };
    }, [active]);
}
