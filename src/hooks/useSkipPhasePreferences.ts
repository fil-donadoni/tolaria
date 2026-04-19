import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
} from "react";
import type { Phase } from "@convex/gre/types";
import {
    DEFAULT_SKIP_PREFS,
    SKIP_PREFS_KEY,
    loadSkipPrefs,
    saveSkipPrefs,
    togglePhaseStop,
    type PhaseSkipPrefs,
    type Side,
} from "~/lib/skip-phase-prefs";

export type UseSkipPhasePreferences = {
    prefs: PhaseSkipPrefs;
    toggle: (phase: Phase, side: Side) => void;
    reset: () => void;
};

export const SkipPhasePrefsContext =
    createContext<UseSkipPhasePreferences | null>(null);

export function useSkipPhasePrefsState(): UseSkipPhasePreferences {
    const [prefs, setPrefs] = useState<PhaseSkipPrefs>(() => loadSkipPrefs());

    useEffect(() => {
        function onStorage(e: StorageEvent) {
            if (e.key !== SKIP_PREFS_KEY) return;
            setPrefs(loadSkipPrefs());
        }
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
    }, []);

    const toggle = useCallback((phase: Phase, side: Side) => {
        setPrefs((prev) => {
            const next = togglePhaseStop(prev, phase, side);
            saveSkipPrefs(next);
            return next;
        });
    }, []);

    const reset = useCallback(() => {
        const next = { ...DEFAULT_SKIP_PREFS };
        saveSkipPrefs(next);
        setPrefs(next);
    }, []);

    return { prefs, toggle, reset };
}

export function useSkipPhasePreferences(): UseSkipPhasePreferences {
    const ctx = useContext(SkipPhasePrefsContext);
    if (!ctx)
        throw new Error(
            "useSkipPhasePreferences must be used within SkipPhasePrefsContext.Provider"
        );
    return ctx;
}
