import { useCallback, useEffect, useState } from "react";

// The one-time "hover to read, ⌘/Ctrl+scroll to resize" hint (issue #9166):
// shown once per player, remembered in `localStorage` — never on every mount.
const STORAGE_KEY = "tolaria:draftZoomHintSeen";
export const DRAFT_ZOOM_HINT_MS = 12000;

function alreadySeen(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        // Storage unavailable: treat as seen, so the hint cannot nag forever.
        return true;
    }
}

/** `active` = the surface that can show the hint (desktop): off, the 12 s
 *  timer must not mark the hint seen for a player who never saw it. */
export function useDraftZoomHint(active = true) {
    const [visible, setVisible] = useState(() => !alreadySeen());

    const dismiss = useCallback(() => {
        setVisible(false);
        try {
            window.localStorage.setItem(STORAGE_KEY, "1");
        } catch {
            // ignore — persistence is best-effort
        }
    }, []);

    useEffect(() => {
        if (!visible || !active) return;
        const id = setTimeout(dismiss, DRAFT_ZOOM_HINT_MS);
        return () => clearTimeout(id);
    }, [visible, active, dismiss]);

    return { visible, dismiss };
}
