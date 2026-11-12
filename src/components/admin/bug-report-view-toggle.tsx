// Switches `/admin/bug-reports` between the open list and the closed history
// (issue #9013). The closed view says how many reports it holds.
import { Button } from "@/components/ui/button";
import type { BugReportView } from "./bug-reports-admin-panel";

export default function BugReportViewToggle({
    view,
    closedCount,
    onChange,
}: {
    view: BugReportView;
    closedCount: number | undefined;
    onChange: (view: BugReportView) => void;
}) {
    return view === "open" ? (
        <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange("closed")}
        >
            Show closed history
            {closedCount === undefined ? "" : ` (${closedCount})`}
        </Button>
    ) : (
        <Button variant="secondary" size="sm" onClick={() => onChange("open")}>
            Back to open reports
        </Button>
    );
}
