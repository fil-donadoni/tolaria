// Watch for a "Report anomaly" ask (issue #3405).
//
// Used by the ONE component that owns the bug-report dialog's open flag
// (`BugReportButton`, mounted at the router root): the decision box asks for a
// report from inside the debug sheet, and this is how that ask crosses the two
// subtrees. Client-only, like the trace store it sits beside.
//
// A SUBSCRIPTION, not a rendered value. The dialog's open flag is React state
// the user can also change (they close it), so the store cannot be its source
// of truth — and a `useSyncExternalStore` value plus an effect that pushed it
// into `setOpen` is exactly the cascading-render shape `react-hooks` rejects.
// What the component actually needs is the EDGE: the moment a request turns on.

import { useEffect, useRef } from "react";
import {
    getAnomalyReportState,
    subscribeAnomalyReport,
} from "~/lib/ai/anomaly-report";

export function useAnomalyReportRequests(onRequest: () => void): void {
    // The latest callback without re-subscribing on every render — the
    // subscription must survive the parent's state changes, and one of those
    // is the very `setOpen` this callback performs. Written in an effect, never
    // during render: a ref mutated while rendering is `react-hooks/refs`.
    const handler = useRef(onRequest);
    useEffect(() => {
        handler.current = onRequest;
    }, [onRequest]);

    useEffect(() => {
        let last = getAnomalyReportState().requested;
        return subscribeAnomalyReport(() => {
            const now = getAnomalyReportState().requested;
            // Only the RISING edge: a second decision reported while the dialog
            // is already open replaces the attached decision and must not
            // re-open anything.
            if (now && !last) handler.current();
            last = now;
        });
    }, []);
}
