import { useCallback, useEffect, useState } from "react";

// The Booster's "Show autopick" toggle (ADR 0095, issue #2271): client-local,
// `localStorage`, same read/write shape as `useCardZoom`'s persisted prefs
// (`src/components/lobby/deck-builder/useCardZoom.ts`). Default OFF: a
// standing Default Pick recommendation displayed on the pack conditions the
// seat's own Pick even when it doesn't mean to (anchoring), so the surface
// never volunteers it — the seat opts in. One key, not per-zone: it is a
// single Draft Room preference, not a per-surface density/zoom value.
const STORAGE_KEY = "tolaria:showAutopick";

function read(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

export function useShowAutopick() {
    const [value, setValue] = useState(read);

    useEffect(() => {
        try {
            window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
        } catch {
            // ignore — persistence is best-effort
        }
    }, [value]);

    const set = useCallback((next: boolean) => setValue(next), []);

    return { value, set };
}
