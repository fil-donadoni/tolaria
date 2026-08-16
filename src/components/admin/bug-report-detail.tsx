// Detail view for one `/admin/bug-reports` row — the whole `bugReports` row,
// read-only (issue #2250). `getBugReport` is `assertIsAdmin`-gated
// server-side (ADR 0033); the route gate above this component is the UI half
// of the same boundary, not a substitute for it.
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@convex/_generated/dataModel";
import { Panel, PanelBody } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import JsonTreeView from "@/components/ui/json-tree-view";
import { copyText } from "@/lib/clipboard";
import BugReportSnapshotHeader from "./bug-report-snapshot-header";
import BugReportAttachment from "./bug-report-attachment";

export type BugReportDetailData = NonNullable<
    FunctionReturnType<typeof api.bugReports.getBugReport>
>;

export default function BugReportDetail({
    reportId,
}: {
    reportId: Id<"bugReports">;
}) {
    const report = useQuery(api.bugReports.getBugReport, { reportId });
    const [copied, setCopied] = useState(false);

    if (report === undefined) {
        return (
            <Panel>
                <PanelBody>
                    <span className="text-sm text-text-muted">Loading…</span>
                </PanelBody>
            </Panel>
        );
    }

    if (report === null) {
        return (
            <Panel>
                <PanelBody>
                    <span className="text-sm text-text-muted">
                        Report not found.
                    </span>
                </PanelBody>
            </Panel>
        );
    }

    const hasSnapshot =
        report.gameId !== undefined &&
        report.seq !== undefined &&
        report.state !== undefined;

    const handleCopyState = () => {
        if (report.state === undefined) return;
        void copyText(JSON.stringify(report.state, null, 2)).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    return (
        <Panel>
            <PanelBody className="gap-4">
                <div>
                    <h3 className="text-base font-semibold text-text">
                        {report.name}
                    </h3>
                    <a
                        href={`mailto:${report.email}`}
                        className="text-sm text-accent-strong underline underline-offset-2 hover:text-accent"
                    >
                        {report.email}
                    </a>
                </div>

                <p className="text-sm whitespace-pre-wrap text-text">
                    {report.description}
                </p>

                <div className="flex flex-col gap-1 text-xs text-text-muted">
                    {report.route && <span>Route: {report.route}</span>}
                    {report.userAgent && (
                        <span>User agent: {report.userAgent}</span>
                    )}
                    {report.issueUrl && (
                        <a
                            href={report.issueUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-accent-strong underline underline-offset-2 hover:text-accent"
                        >
                            Issue{" "}
                            {report.issueNumber !== undefined
                                ? `#${report.issueNumber}`
                                : ""}
                        </a>
                    )}
                </div>

                {report.attachmentUrl && (
                    <BugReportAttachment
                        url={report.attachmentUrl}
                        name={report.attachmentName}
                    />
                )}

                {hasSnapshot && (
                    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                        <BugReportSnapshotHeader
                            snapshot={{
                                gameId: report.gameId as string,
                                seq: report.seq as number,
                                state: report.state as Record<string, unknown>,
                            }}
                        />
                        <div className="flex items-center justify-between">
                            <span className="text-label">Full state</span>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={handleCopyState}
                            >
                                {copied ? "Copied!" : "Copy state JSON"}
                            </Button>
                        </div>
                        <div className="max-h-[60vh] overflow-auto rounded-sm border border-border-subtle p-2 font-mono text-xs">
                            <JsonTreeView data={report.state} />
                        </div>
                    </div>
                )}

                {/* issue #2470 — the bot's decision and escalation rings. The
                    play bot is client-hosted (ADR 0074), so this is the ONLY
                    record of why one of its decisions failed: the board
                    snapshot above shows the position, this shows whether the
                    Brain ever answered for it. */}
                {report.clientDiagnostics !== undefined && (
                    <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                        <span className="text-label">AI diagnostics</span>
                        <div className="max-h-[60vh] overflow-auto rounded-sm border border-border-subtle p-2 font-mono text-xs">
                            <JsonTreeView data={report.clientDiagnostics} />
                        </div>
                    </div>
                )}
            </PanelBody>
        </Panel>
    );
}
