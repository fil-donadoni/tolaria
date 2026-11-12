import { useEffect } from "react";
import { acceptsShortcut } from "~/lib/keyboard-shortcuts";

/** Space = "Start now" during the Draft's table intro (issue #9167) — the
 *  app-wide confirm key, admitted through the shared `acceptsShortcut` test
 *  (not while typing, not behind a dialog) like every other window shortcut.
 *  A focused button keeps its own Space activation, so it is left alone. */
export function useDraftStartNowHotkey(
    enabled: boolean,
    onStartNow: () => void
): void {
    useEffect(() => {
        if (!enabled) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.code !== "Space" || event.repeat) return;
            if (!acceptsShortcut(event)) return;
            if (event.target instanceof HTMLButtonElement) return;
            event.preventDefault();
            onStartNow();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [enabled, onStartNow]);
}
