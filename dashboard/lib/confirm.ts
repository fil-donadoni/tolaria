import { useSyncExternalStore } from "react";
import type { ActionId } from "./actions";

/**
 * The action awaiting confirmation (PRD #3148 S2).
 *
 * A store for the same reason the watch target is one: the buttons that raise
 * a confirmation live in two unrelated places — the verdict band's
 * Stop/Resume, and a Release on any orphaned claim row — and there is exactly
 * one dialog for all of them.
 *
 * WHAT THE DIALOG CAPTURES AT OPEN TIME, and why that is not a bug: the page
 * behind it keeps polling, so the verdict that offered the action can change
 * while the dialog is open. The wording does not live-update — cancelling and
 * re-opening picks up the fresh state — and the triggering button may not even
 * exist by the time Confirm is pressed. Nothing here holds a reference back to
 * it, only the action, the issue and the element to hand focus back to, so
 * that is harmless (#2636's own trade-off, restated).
 */

export interface PendingAction {
    action: ActionId;
    /** `claim.release` only — already coerced to a positive integer. */
    issue?: number;
    opener: HTMLElement | null;
}

let pending: PendingAction | null = null;
const listeners = new Set<() => void>();

function publish(next: PendingAction | null): void {
    pending = next;
    for (const fn of listeners) fn();
}

export const getPendingAction = (): PendingAction | null => pending;

export function subscribeToPendingAction(
    onStoreChange: () => void
): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

export function requestAction(next: PendingAction): void {
    publish(next);
}

/** Close the dialog and give focus back to the button that raised it. */
export function dismissAction(): void {
    const opener = pending?.opener ?? null;
    publish(null);
    if (opener && typeof opener.focus === "function" && opener.isConnected) {
        opener.focus({ preventScroll: true });
    }
}

export const usePendingAction = (): PendingAction | null =>
    useSyncExternalStore(subscribeToPendingAction, getPendingAction);

/** Test-only. */
export const resetPendingAction = (): void => {
    pending = null;
    listeners.clear();
};
