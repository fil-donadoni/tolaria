// `/admin/bug-reports` — the evidence PR #2243 moved off the public issue
// (email, full game state, attachment) reachable from a page instead of only
// `bunx convex run bugReports:getReport … --prod` (issue #2250). Read-only:
// no edit/delete affordance exists here, matching the row's role as evidence
// rather than a work item.
//
// Master/detail in ONE component, state-driven — same shape as
// `ScenariosAdminPanel`'s create/edit panels, not a child route: selecting a
// row just sets `selectedId`, and `BugReportDetail` re-queries on change.
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import BugReportListRow from "./bug-report-list-row";
import BugReportDetail from "./bug-report-detail";

export type BugReportListItem = FunctionReturnType<
    typeof api.bugReports.listBugReports
>[number];

export default function BugReportsAdminPanel() {
    const reports = useQuery(api.bugReports.listBugReports, {});
    const [selectedId, setSelectedId] = useState<Id<"bugReports"> | null>(null);

    const total = reports?.length ?? 0;

    return (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Panel>
                <PanelHeader
                    title="Reports"
                    subtitle={
                        reports === undefined ? "Loading…" : `${total} total`
                    }
                />
                <PanelBody className="flex flex-col gap-1">
                    {reports === undefined ? (
                        <span className="text-xs text-text-disabled">
                            Loading…
                        </span>
                    ) : reports.length === 0 ? (
                        <span className="text-xs text-text-disabled">
                            No bug reports filed yet
                        </span>
                    ) : (
                        reports.map((row) => (
                            <BugReportListRow
                                key={row._id}
                                row={row}
                                selected={row._id === selectedId}
                                onSelect={() => setSelectedId(row._id)}
                            />
                        ))
                    )}
                </PanelBody>
            </Panel>

            {selectedId ? (
                <BugReportDetail reportId={selectedId} />
            ) : (
                <Panel>
                    <PanelBody>
                        <span className="text-sm text-text-muted">
                            Select a report to see the full evidence.
                        </span>
                    </PanelBody>
                </Panel>
            )}
        </div>
    );
}
