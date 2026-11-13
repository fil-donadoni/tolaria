// One seam action per page mount (issue #9272, ADR 0180): the shared shape of
// every seam page that writes — run the server shortcut once, then route on;
// a refusal becomes the page's printed error, never an unhandled rejection.
// Seam code only: imported by seam pages, which only a DEV bundle registers.
import { useEffect, useRef, useState } from "react";

/** Runs `action` once per mount and returns its refusal, if any. `null`
 *  while it runs or after it succeeded (a success routes away). With no
 *  `action` (a missing argument) nothing runs and `missing` is the error. */
export function useUiSeamAction(
    action: (() => Promise<void>) | null,
    missing: string
): string | null {
    const [error, setError] = useState<string | null>(null);
    // StrictMode runs an effect twice in development, and a second call would
    // repeat a write the first just made.
    const started = useRef(false);
    useEffect(() => {
        if (!action || started.current) return;
        started.current = true;
        action().catch((e: unknown) => {
            setError(e instanceof Error ? e.message : String(e));
        });
    }, [action]);
    return action ? error : missing;
}
