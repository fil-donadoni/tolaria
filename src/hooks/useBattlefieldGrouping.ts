import { useCallback, useSyncExternalStore } from "react";
import {
    loadBattlefieldGrouping,
    saveBattlefieldGrouping,
    type BattlefieldGrouping,
} from "~/lib/boardViewPrefs";

// One preference read by both battlefields and written from two surfaces (the
// in-game Game Menu and Settings → Board, issue #7429): an external store over
// the localStorage seam, so a toggle in the menu re-lays the open board out
// without a reload — same shape as `useSplitCreatures`.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** The battlefield grouping preference ("stacked" by default, remembered per
 *  device) and its setter. */
export function useBattlefieldGrouping(): [
    BattlefieldGrouping,
    (grouping: BattlefieldGrouping) => void,
] {
    const grouping = useSyncExternalStore(subscribe, () =>
        loadBattlefieldGrouping()
    );
    const setGrouping = useCallback((next: BattlefieldGrouping) => {
        saveBattlefieldGrouping(next);
        listeners.forEach((l) => l());
    }, []);
    return [grouping, setGrouping];
}
