import { useCallback, useEffect, useState } from "react";

// Per-zone card zoom (MTGO-style). The slider stores a *multiplier* applied to
// the responsive base size (`--card-base`), so cards stay viewport-aware while
// the user scales them. Each zone (results / main / side) persists its own
// multiplier independently — a sparse zone can be zoomed up while a crowded one
// stays small.
export interface ZoomConfig {
    /** localStorage key suffix, e.g. "results". */
    zone: string;
    /** Smallest multiplier — the current/default density is the floor. */
    min: number;
    max: number;
    /** Initial value when nothing is persisted (slightly above `min`). */
    initial: number;
}

const STORAGE_PREFIX = "tolaria:deckbuilderZoom:";
export const ZOOM_STEP = 0.05;

function read(key: string, fallback: number, min: number, max: number): number {
    try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
        if (raw === null) return fallback;
        const n = Number.parseFloat(raw);
        if (Number.isNaN(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    } catch {
        return fallback;
    }
}

export function useCardZoom({ zone, min, max, initial }: ZoomConfig) {
    const [value, setValue] = useState(() => read(zone, initial, min, max));

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_PREFIX + zone, String(value));
        } catch {
            // ignore — persistence is best-effort
        }
    }, [zone, value]);

    const set = useCallback(
        (next: number) => setValue(Math.min(max, Math.max(min, next))),
        [min, max]
    );

    return { value, set, min, max };
}
