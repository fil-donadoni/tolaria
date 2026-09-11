// Subscribe to the anomaly-report hand-off (issue #3405).
//
// Read by the ONE component that owns the bug-report dialog's open flag
// (`BugReportButton`, mounted at the router root): the decision box asks for a
// report from inside the debug sheet, and this is how that ask crosses the two
// subtrees. Client-only, like the trace store it sits beside.

import { useSyncExternalStore } from "react";
import {
    getAnomalyReportState,
    subscribeAnomalyReport,
} from "~/lib/ai/anomaly-report";

export function useAnomalyReport() {
    return useSyncExternalStore(
        subscribeAnomalyReport,
        getAnomalyReportState,
        getAnomalyReportState
    );
}
