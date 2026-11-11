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

export function useDraftZoomHint() {
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
        if (!visible) return;
        const id = setTimeout(dismiss, DRAFT_ZOOM_HINT_MS);
        return () => clearTimeout(id);
    }, [visible, dismiss]);

    return { visible, dismiss };
}
