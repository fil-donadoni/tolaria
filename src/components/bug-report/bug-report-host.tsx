import { useEffect, useState } from "react";
import { useAnomalyReportRequests } from "~/hooks/useAnomalyReport";
import { clearAnomalyReport } from "~/lib/ai/anomaly-report";
import { subscribeBugReportRequests } from "~/lib/bug-report-requests";
import BugReportDialog from "./bug-report-dialog";

/**
 * The ONE owner of the bug-report dialog's open flag, mounted once at the
 * router root so the dialog outlives whichever surface asked for it (issue
 * #3419). It renders no trigger of its own: every `BugReportButton` — floating
 * off the board, inline in the controller on it — and the pause menu's entry
 * ask through `requestBugReport`, so all of them open this same dialog with the
 * same consent step and the same diagnostic payload.
 */
export default function BugReportHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => subscribeBugReportRequests(() => setOpen(true)), []);

    // "Report anomaly", from a decision in the AI box (issue #3405). The debug
    // sheet is in another subtree, so the ask arrives through the anomaly store.
    useAnomalyReportRequests(() => setOpen(true));

    // Closing the dialog drops the decision with it — the payload is assembled
    // at submit time, and a decision left behind would attach itself to the
    // NEXT report, filed from somewhere else entirely.
    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (!next) clearAnomalyReport();
    };

    return <BugReportDialog open={open} onOpenChange={handleOpenChange} />;
}
