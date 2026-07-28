import { useSyncExternalStore } from "react";
import {
    hasPendingGameIntent,
    subscribePendingGameIntent,
} from "~/lib/pending-intent-store";

/** `true` while a client-dispatched game intent (cast / play / activate) is
 *  still round-tripping. See `pending-intent-store.ts` — the hotkey handler
 *  uses it to refuse the `passPriority` / `endTurn` fall-through so a Space
 *  aimed at the not-yet-rendered payment banner can't advance the phase. */
export function usePendingGameIntent(): boolean {
    return useSyncExternalStore(
        subscribePendingGameIntent,
        hasPendingGameIntent,
        () => false
    );
}
