import { useEffect, useState } from "react";

const STORAGE_PREFIX = "orientation-hint-seen:";

function hasBeenSeen(surfaceId: string): boolean {
    try {
        return sessionStorage.getItem(STORAGE_PREFIX + surfaceId) === "1";
    } catch {
        // Storage unavailable (private mode, disabled storage, SSR) — treat
        // as never seen. The hint still won't reappear WITHIN this mount
        // (React state), it just can't remember across a remount this
        // "session" — a degraded but safe fallback, never a crash.
        return false;
    }
}

function markSeen(surfaceId: string): void {
    try {
        sessionStorage.setItem(STORAGE_PREFIX + surfaceId, "1");
    } catch {
        // Nothing to persist — see hasBeenSeen.
    }
}

export interface OrientationHintProps {
    /** Discriminates the sessionStorage key so dismissing one surface's hint
     *  (e.g. "game-board") never suppresses another's (e.g. "draft-room"). */
    surfaceId: string;
    /** The hint copy — what rotating unlocks on this surface. */
    message: string;
}

/**
 * A dismissible, non-blocking orientation nudge, shown at most once per
 * surface per browser session (issue #2594).
 *
 * **Never a block**: both the board and the Draft Room already ship complete,
 * independently-designed portrait AND landscape layouts (ADR 0101; the
 * board's landscape stack-right-panel, issue #2639) — this is
 * discoverability for the alternate layout, not a warning that the current
 * one is broken. The caller decides WHEN to mount it (current viewport mode,
 * which surface) — this component owns only the once-per-session/dismissible
 * mechanism, so it stays reusable across surfaces without hard-coding any
 * surface's orientation preference.
 *
 * "Once per session" is enforced at mount time (not only on explicit
 * dismiss): the flag flips as soon as the hint is shown, so navigating away
 * and back to the same surface in the same session does not re-show it. The
 * dismiss button is a faster, explicit way to close the CURRENT instance —
 * functionally it just brings dismissal forward, since the seen-flag is
 * already set.
 */
export default function OrientationHint({
    surfaceId,
    message,
}: OrientationHintProps) {
    const [dismissed, setDismissed] = useState(false);
    // Read once, at mount — a value that must not change across this
    // instance's lifetime (re-reading on every render would flicker the
    // banner back in if some OTHER code cleared the flag mid-session).
    const [alreadySeen] = useState(() => hasBeenSeen(surfaceId));

    useEffect(() => {
        if (!alreadySeen) markSeen(surfaceId);
        // Deliberately no cleanup: the seen-flag is a session-lifetime mark,
        // not tied to this component's mount lifecycle.
    }, [surfaceId, alreadySeen]);

    if (alreadySeen || dismissed) return null;

    return (
        <div
            role="status"
            data-orientation-hint={surfaceId}
            className="relative z-20 flex shrink-0 items-center justify-between gap-3 bg-surface-elevated px-3 py-2 text-xs text-text-muted"
        >
            <span>{message}</span>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss orientation hint"
                className="shrink-0 cursor-pointer rounded px-1 text-text-muted hover:text-text"
            >
                ✕
            </button>
        </div>
    );
}
