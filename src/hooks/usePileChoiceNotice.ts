import { useState } from "react";
import type { PileChoiceNotice } from "~/types/game";
import {
    INITIAL_PILE_NOTICE_TRACKER,
    trackPileNotice,
} from "~/lib/pile-choice-notice";

/** Issue #5661 — the pile pick to confirm, derived from the snapshot's
 *  `lastPileChoice` (see `trackPileNotice`). Runs above the board's loading
 *  return, so `loaded` gates the baseline. Tracked DURING render (React's
 *  "derive state from the previous render" form), like the board's own
 *  last-resident snapshot. */
export function usePileChoiceNotice(
    loaded: boolean,
    notice: PileChoiceNotice | undefined
): { confirm: PileChoiceNotice | null; dismiss: () => void } {
    const [tracker, setTracker] = useState(INITIAL_PILE_NOTICE_TRACKER);
    const [confirm, setConfirm] = useState<PileChoiceNotice | null>(null);
    const next = trackPileNotice(tracker, loaded, notice);
    if (next.tracker !== tracker) setTracker(next.tracker);
    if (next.confirm) setConfirm(next.confirm);
    return { confirm, dismiss: () => setConfirm(null) };
}
