import { useEffect } from "react";

/** Every overlay that already owns <kbd>Escape</kbd> on either board. While one
 *  is in the DOM the keystroke is ITS dismissal, so the pause menu must not
 *  open behind it in the same keystroke. */
const POPUP_SELECTORS = [
    '[data-slot="dialog-content"]',
    '[data-slot="popover-content"]',
    '[data-slot="context-menu-content"]',
    // The tester debug sheet (issue #3403). It is NON-modal, so nothing else
    // stops this handler from running while it is open: without this entry
    // Escape would close the sheet AND pop the pause menu behind it in the
    // same keystroke.
    '[data-slot="sheet-content"]',
].join(",");

/** <kbd>Escape</kbd> opens the pause menu — on the GRE board (`board.tsx`) and
 *  on the Manual Board (`manual-board-view.tsx`, issue #2353) alike, so both
 *  share one guard rather than two drifting copies of it.
 *
 *  Guards: nothing while `enabled` is false (the GRE board passes its
 *  game-over flag; the Manual Board the surfaces it owns the state of), and
 *  nothing while any {@link POPUP_SELECTORS} overlay — or one of the caller's
 *  `extraBlockers` — is mounted. The probe runs at keydown time, before any
 *  overlay's own Escape handler has re-rendered it away, so the overlay
 *  closing on the same keystroke is still seen as open. */
export function usePauseMenuHotkey({
    enabled,
    onOpen,
    extraBlockers,
}: {
    enabled: boolean;
    onOpen: () => void;
    /** Board-specific overlays that consume Escape without carrying one of the
     *  shared `data-slot` markers, as one CSS selector list. */
    extraBlockers?: string;
}): void {
    useEffect(() => {
        if (!enabled) return;
        const blockers = extraBlockers
            ? `${POPUP_SELECTORS},${extraBlockers}`
            : POPUP_SELECTORS;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (document.querySelector(blockers)) return;
            e.preventDefault();
            onOpen();
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [enabled, onOpen, extraBlockers]);
}
