// PROTOTYPE — throwaway (player-feedback 2026-11, `pv-zoom`). Never merge.
import { useCallback, useState } from "react";

/** The proposed bigger default (real one: 1.2, `limited-draft-table.tsx`). */
export const PROTOTYPE_ZOOM_DEFAULT = 1.5;
const MIN = 1;
const MAX = 2.2;

export interface PrototypeZoom {
    value: number;
    set: (next: number) => void;
    min: number;
    max: number;
}

/** Same shape as `useCardZoom`, but NOT persisted: it ignores the stored
 *  `tolaria:deckbuilderZoom:limited-booster` so every variant opens at the
 *  proposed default (a reload resets it). */
export function usePrototypeZoom(): PrototypeZoom {
    const [value, setValue] = useState(PROTOTYPE_ZOOM_DEFAULT);
    const set = useCallback(
        (next: number) => setValue(Math.min(MAX, Math.max(MIN, next))),
        []
    );
    return { value, set, min: MIN, max: MAX };
}
