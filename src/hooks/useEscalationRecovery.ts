// An escalated subscription that comes back on its own (issue #10407).
//
// `useResilientQuery` parks a subscription for good once it escalates: only
// its `retry()` un-parks it. For the vs-Bot driver that meant a passing
// overload — a backend that failed one query with "too many system
// operations" past the whole backoff ladder — stopped the Bot until the
// player noticed the "lost contact" banner and clicked Reconnect, while the
// server backstop (`convex/botDeadline.ts`) passed the Bot's decisions.
//
// This hook is the click, made by the machine:
//   - a TRANSIENT escalation (the budget ran out on a timeout / overload)
//     re-tries `ESCALATED_RETRY_MS` after escalating. The retry resets the
//     budget, so a backend still struggling sees one more backoff ladder
//     (five executions over ~4s), a fresh escalation, and the next window —
//     slow, never a spin;
//   - ANY escalation re-tries when the tab becomes visible again or the
//     browser comes back online: those are the moments a stale failure is
//     most likely over, and each is a single, user-paced attempt — a genuine
//     function bug (a non-transient error) is never put on a timer.

import { useEffect } from "react";
import {
    ESCALATED_RETRY_MS,
    isTransientQueryError,
} from "~/lib/transient-query-error";

export function useEscalationRecovery(
    error: Error | null,
    retry: () => void
): void {
    const escalated = error !== null;
    const transient = escalated && isTransientQueryError(error);

    useEffect(() => {
        if (!transient) return;
        // One shot per escalation: `retry()` clears `error`, which tears this
        // effect down; the next escalation arms the next window.
        const timer = setTimeout(retry, ESCALATED_RETRY_MS);
        return () => clearTimeout(timer);
    }, [transient, retry]);

    useEffect(() => {
        if (!escalated) return;
        const onVisible = () => {
            if (document.visibilityState === "visible") retry();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("online", retry);
        return () => {
            document.removeEventListener("visibilitychange", onVisible);
            window.removeEventListener("online", retry);
        };
    }, [escalated, retry]);
}
