/**
 * True when a keyboard event's target is a text-entry element the user is
 * actively typing into — an <input>, <textarea>, or any contenteditable node.
 *
 * Global window-level keydown handlers (priority hotkeys, modal pickers) must
 * bail out on these so Space/Enter/single-letter keys type normally instead of
 * being hijacked as game shortcuts.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return target.isContentEditable;
}
