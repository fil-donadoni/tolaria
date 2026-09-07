import { useSyncExternalStore } from "react";

/**
 * Which session the tail drawer is following (PRD #3148 S2).
 *
 * A STORE, not state on `NowView`, because the Watch buttons that re-point it
 * live in two different tables several levels down (a claim row and a
 * live-session row), and both must be able to SWITCH an already-open drawer
 * rather than open a second one.
 *
 * `opener` is the element the drawer must hand focus back to on close. base-ui
 * restores focus to a `Dialog.Trigger`, but there is no single trigger here —
 * any of a dozen Watch buttons can open the same drawer, and the one that did
 * is only known at click time. Holding the element is what the vanilla drawer
 * did (`state.opener`, now-tail.js) and the reason survives the port intact.
 */

export interface WatchTarget {
    session: string;
    /** The heading the drawer shows — a session's title, prompt or id. */
    label: string;
    /** The issue the row was about, when it was a claim row. */
    issue: number | null;
    opener: HTMLElement | null;
}

let target: WatchTarget | null = null;
const listeners = new Set<() => void>();

function publish(next: WatchTarget | null): void {
    target = next;
    for (const fn of listeners) fn();
}

export const getWatchTarget = (): WatchTarget | null => target;

export function subscribeToWatch(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange);
    return () => {
        listeners.delete(onStoreChange);
    };
}

/** Open the drawer, or re-point an open one at another session. */
export function openWatch(next: {
    session: string;
    label: string;
    issue?: number | null;
    opener?: HTMLElement | null;
}): void {
    publish({
        session: next.session,
        label: next.label,
        issue: next.issue ?? null,
        opener: next.opener ?? null,
    });
}

/** Close the drawer and give focus back to whatever opened it. */
export function closeWatch(): void {
    const opener = target?.opener ?? null;
    publish(null);
    if (opener && typeof opener.focus === "function" && opener.isConnected) {
        opener.focus({ preventScroll: true });
    }
}

export const useWatchTarget = (): WatchTarget | null =>
    useSyncExternalStore(subscribeToWatch, getWatchTarget);

/** Test-only. */
export const resetWatch = (): void => {
    target = null;
    listeners.clear();
};
