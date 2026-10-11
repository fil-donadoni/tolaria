/** Single vs double click on a Draft Room pack card (issue #5396, PRD #5384).
 *
 *  On a fine pointer (mouse / pen) a single click must not open the card menu
 *  at once: it waits the double-click interval, and a second click inside it
 *  is a Pick with the menu never having opened. Touch, keyboard-synthesised
 *  clicks (no pointer at all) and anything unknown keep the old behaviour —
 *  the menu opens immediately. Pure: the component owns the timer and the
 *  clock, this module only decides. */

/** How long a single click waits for a second one (ms). One constant, shared
 *  by the decision and the component's timer. */
export const DOUBLE_CLICK_INTERVAL_MS = 250;

/** `PointerEvent.pointerType`, plus `""`/`undefined` for "no pointer seen"
 *  (keyboard-synthesised click, old test events). */
export type DraftPointerKind = string | undefined;

export type DraftClickIntent =
    /** Open the menu right now (touch, keyboard, unknown pointer). */
    | "open-menu"
    /** Arm the interval timer; open the menu if no second click came. */
    | "open-menu-after-interval"
    /** Second click inside the interval: commit the Pick, no menu. */
    | "pick";

/** A fine pointer is a mouse or a pen; everything else keeps today's regime. */
export function isFinePointer(kind: DraftPointerKind): boolean {
    return kind === "mouse" || kind === "pen";
}

/** What a click means, given the pointer that produced it and the time since
 *  the previous click on the same card (`null` = none yet). */
export function decideClick(
    kind: DraftPointerKind,
    sinceLastClickMs: number | null
): DraftClickIntent {
    if (!isFinePointer(kind)) return "open-menu";
    if (
        sinceLastClickMs !== null &&
        sinceLastClickMs <= DOUBLE_CLICK_INTERVAL_MS
    )
        return "pick";
    return "open-menu-after-interval";
}
