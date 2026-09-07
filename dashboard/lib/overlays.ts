import { useEffect, useSyncExternalStore } from "react";

/**
 * Which overlays are open, and which one owns `Escape` (PRD #3148 S2).
 *
 * ── WHY A REGISTER AND NOT THREE INDEPENDENT DIALOGS ──────────────────────
 *
 * The Now view can have three overlays open at once: the shortcuts sheet, an
 * action-confirmation dialog, and the session tail drawer. Every one of them
 * is a base-ui dialog, and base-ui binds its `Escape` listener on the DOCUMENT
 * (`floating-ui-react/hooks/useDismiss`), which is exactly what the issue asks
 * for — `Escape` closes the drawer from ANYWHERE on the page, not only while
 * focus is inside it, which is the defect the hand-written drawer shipped.
 *
 * The cost of that correctness is that ALL THREE hear the same keystroke. With
 * the sheet open over the drawer, one `Escape` would close both. So precedence
 * is stated ONCE, here, and each dialog cancels base-ui's own handling when it
 * is not the topmost — `details.cancel()`, the primitive's own escape hatch,
 * rather than a second document-level keydown listener racing the first.
 *
 * Order is the reading order of a stack: the sheet is the most recently opened
 * thing an operator can be looking at, the confirmation dialog is modal over
 * the page, and the drawer is the non-modal thing that was already there.
 */
export const OVERLAY_PRECEDENCE = ["shortcuts", "confirm", "tail"] as const;

export type OverlayId = (typeof OVERLAY_PRECEDENCE)[number];

/**
 * The overlays that make every OTHER keyboard shortcut inert while they are
 * open. The tail drawer is deliberately not one: it declares itself non-modal
 * (`modal={false}`), the page behind it keeps polling and stays usable, and a
 * `1` pressed beside it must still switch views. A modal that still let the
 * view change underneath it would not read as modal at all (#2635/#2636).
 */
export const MODAL_OVERLAYS: readonly OverlayId[] = ["shortcuts", "confirm"];

const open = new Set<OverlayId>();
const listeners = new Set<() => void>();

/** A referentially stable snapshot: `useSyncExternalStore` compares with
 *  `Object.is`, so returning a fresh array each read would loop forever. */
let snapshot: readonly OverlayId[] = [];

function publish(): void {
    snapshot = OVERLAY_PRECEDENCE.filter((id) => open.has(id));
    for (const fn of listeners) fn();
}

export function setOverlayOpen(id: OverlayId, isOpen: boolean): void {
    if (isOpen === open.has(id)) return;
    if (isOpen) open.add(id);
    else open.delete(id);
    publish();
}

export const isOverlayOpen = (id: OverlayId): boolean => open.has(id);

/** Which overlay owns `Escape` right now, or `null` when none is open. */
export const topmostOverlay = (): OverlayId | null => snapshot[0] ?? null;

/** True while an overlay that suppresses the keyboard layer is open. */
export const modalOverlayOpen = (): boolean =>
    MODAL_OVERLAYS.some((id) => open.has(id));

export const getOpenOverlays = (): readonly OverlayId[] => snapshot;

export function subscribeToOverlays(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

export const useOpenOverlays = (): readonly OverlayId[] =>
    useSyncExternalStore(subscribeToOverlays, getOpenOverlays);

/**
 * Register an overlay's open state for as long as the component is mounted,
 * and deregister on unmount — a dialog that unmounted while open must not
 * leave the register claiming it still owns `Escape`.
 */
export function useOverlayRegistration(id: OverlayId, isOpen: boolean): void {
    useEffect(() => {
        setOverlayOpen(id, isOpen);
        return () => setOverlayOpen(id, false);
    }, [id, isOpen]);
}

/**
 * Whether this overlay should let base-ui act on a change event, given the
 * precedence above. Only `Escape` is arbitrated: an outside press or a close
 * button names ONE overlay by construction, so nothing has to be resolved.
 */
export const ownsEscape = (id: OverlayId): boolean => topmostOverlay() === id;

/** Test-only: empty the register between files that swap the document. */
export function resetOverlays(): void {
    open.clear();
    snapshot = [];
    listeners.clear();
}
