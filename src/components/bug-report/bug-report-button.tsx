import { Bug } from "lucide-react";
import { requestBugReport } from "~/lib/bug-report-requests";

/**
 * The bug-report trigger (issue #3419). It owns no dialog and no position: it
 * asks the router-root `BugReportHost` to open, and its placement is entirely
 * the caller's `className` — the same trigger renders floating at the router
 * root (`BugReportFloatingButton`) and inline inside the desktop pod and the
 * landscape strip, each in that host's own control register.
 */
export default function BugReportButton({ className }: { className: string }) {
    return (
        <button
            type="button"
            aria-label="Report a bug"
            title="Report a bug"
            onClick={requestBugReport}
            className={className}
        >
            <Bug className="h-4 w-4" aria-hidden />
        </button>
    );
}
