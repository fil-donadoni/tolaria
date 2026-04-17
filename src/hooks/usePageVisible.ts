import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
}

function getSnapshot() {
    return document.visibilityState === "visible";
}

/** Returns `true` when the tab is visible, `false` when hidden (e.g. minimized, switched tab, or screen off). */
export function usePageVisible(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot);
}
