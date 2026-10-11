import { useCallback, useSyncExternalStore } from "react";
import { loadSplitCreatures, saveSplitCreatures } from "~/lib/deckViewPrefs";

// One preference shared by every Zone surface (issue #5399): the Maindeck and
// Sideboard toggles must agree without a reload, so the value is an external
// store over the localStorage seam rather than per-component state.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The "Split creatures" preference (off by default, remembered) and its setter. */
export function useSplitCreatures(): [boolean, (split: boolean) => void] {
    const split = useSyncExternalStore(subscribe, () => loadSplitCreatures());
    const setSplit = useCallback((next: boolean) => {
        saveSplitCreatures(next);
        listeners.forEach((l) => l());
    }, []);
    return [split, setSplit];
}
