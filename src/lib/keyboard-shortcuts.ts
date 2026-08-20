/**
 * The shared admission rules for a window-level keyboard shortcut (issue
 * #2593).
 *
 * Extracted from `useDraftKeyboardPicks` (#2587) when the second and third
 * consumers arrived — the deckbuilder's `/`-focuses-search binding and the
 * editing surfaces' Escape. Three copies of "is the user typing?" is exactly
 * the shape that drifts: the Draft Room's copy already knew about
 * `isContentEditable` and an open `[role=dialog]`, and a hand-rolled second
 * copy would not have.
 */

/** Where a key event came from — a typing context swallows the shortcut. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target.isContentEditable
    );
}

/** A modal is on screen. Used as a "someone else owns the keyboard" test: the
 *  Inspect Overlay, `ui/dialog.tsx` and `ui/bottom-sheet.tsx` all render
 *  `role="dialog"`. */
export function isDialogOpen(doc: Document = document): boolean {
    return doc.querySelector("[role=dialog]") !== null;
}

/**
 * Should a window-level shortcut act on this event?
 *
 * Rejects an already-handled event, any modifier combination (those belong to
 * the browser and the OS), and a key typed into a field. By default it also
 * defers to an open dialog — pass `whileDialogOpen` for a binding that IS the
 * dialog's own (Escape).
 */
export function acceptsShortcut(
    event: KeyboardEvent,
    options: { whileDialogOpen?: boolean } = {}
): boolean {
    if (event.defaultPrevented) return false;
    if (event.metaKey || event.ctrlKey || event.altKey) return false;
    if (isTypingTarget(event.target)) return false;
    if (!options.whileDialogOpen && isDialogOpen()) return false;
    return true;
}
