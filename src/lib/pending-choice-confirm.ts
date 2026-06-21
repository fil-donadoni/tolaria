import type { PendingChoice } from "~/types/game";

/** Lower bound of a {@link PendingChoice.count}, regardless of whether it's the
 *  fixed-N shape (`min === count`) or the `{ min, max }` range shape. */
export function pendingChoiceMin(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.min;
}

/** Upper bound of a {@link PendingChoice.count}. */
export function pendingChoiceMax(count: PendingChoice["count"]): number {
    return typeof count === "number" ? count : count.max;
}

/** Whether a zone-pick choice's Done/Skip button is legal to fire given the
 *  number of items currently buffered (ADR 0007). The confirm enables once the
 *  buffer is within `[min, max]` — for range choices (e.g. Sylvan Library's
 *  0–N topdeck pick) that means Done is enabled at the MINIMUM allowed
 *  selection, including 0 when `min === 0`. Pure so it can be unit-tested apart
 *  from the hook that wires it to game context. */
export function isZonePickConfirmEnabled(
    count: PendingChoice["count"],
    selected: number
): boolean {
    return (
        selected >= pendingChoiceMin(count) &&
        selected <= pendingChoiceMax(count)
    );
}
