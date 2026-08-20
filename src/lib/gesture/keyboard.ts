/** Keyboard equivalents of the editing-surface touch model (PRD #2405 story
 *  52, ADR 0101): arrows select, Enter is the primary CTA, S the secondary,
 *  `/` focuses search. Pure so every surface resolves a key the same way
 *  instead of each growing its own `switch`.
 *
 *  This is a decision function only. WHICH card "previous"/"next" means, and
 *  what "primary" does, belong to the surface — the same way the Peek Panel
 *  takes its CTA set from the surface rather than inventing one. */
export type EditingKeyAction =
    | "select-previous"
    | "select-next"
    | "select-up"
    | "select-down"
    | "primary"
    | "secondary"
    | "search"
    | "dismiss";

/** The subset of `KeyboardEvent` this reads — so a caller can pass a React
 *  synthetic event, a native one, or a plain object in a test. */
export interface EditingKeyEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
}

/**
 * `null` when the surface should leave the key alone — which is the important
 * half of the contract: a modified chord is the browser's or the OS's (⌘F,
 * ⌃A), and a bare letter typed into an input is TEXT. Callers pass only
 * events that did not originate in a text field.
 */
export function editingKeyAction(
    event: EditingKeyEvent
): EditingKeyAction | null {
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    switch (event.key) {
        case "ArrowLeft":
            return "select-previous";
        case "ArrowRight":
            return "select-next";
        case "ArrowUp":
            return "select-up";
        case "ArrowDown":
            return "select-down";
        case "Enter":
            return "primary";
        case "s":
        case "S":
            return "secondary";
        case "/":
            return "search";
        case "Escape":
            return "dismiss";
        default:
            return null;
    }
}
