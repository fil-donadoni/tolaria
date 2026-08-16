// One row of the `/admin/bug-reports` list: filed-at, reporter, first line of
// the description, linked issue (when there is one), and which attachments the
// report carries — a game snapshot, and the bot's decision rings (issue #2470,
// the badge that says this report can answer "did the Brain ever answer?"
// without opening it). Pure presentational — selection state lives in the
// parent (`BugReportsAdminPanel`), same split as `DebugScenarioRow`.
import type { BugReportListItem } from "./bug-reports-admin-panel";

function formatFiledAt(ms: number): string {
    return new Date(ms).toLocaleString();
}

export default function BugReportListRow({
    row,
    selected,
    onSelect,
}: {
    row: BugReportListItem;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`flex w-full flex-col gap-0.5 rounded-sm border px-3 py-2 text-left transition-colors ${
                selected
                    ? "border-border-accent bg-surface-elevated/60"
                    : "border-border-subtle hover:border-border-accent/60"
            }`}
        >
            <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <span>{formatFiledAt(row.filedAt)}</span>
                <div className="flex items-center gap-2">
                    {row.hasSnapshot && (
                        <span className="rounded-sm bg-accent-soft/30 px-1.5 py-0.5 text-[10px] tracking-wide text-accent-strong uppercase">
                            snapshot
                        </span>
                    )}
                    {row.hasDiagnostics && (
                        <span className="rounded-sm bg-accent-soft/30 px-1.5 py-0.5 text-[10px] tracking-wide text-accent-strong uppercase">
                            AI
                        </span>
                    )}
                    {row.issueNumber !== undefined && (
                        <span className="text-text-muted">
                            #{row.issueNumber}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-baseline gap-2">
                <span className="font-semibold text-text">{row.name}</span>
                <span className="truncate text-sm text-text-muted">
                    {row.descriptionPreview}
                </span>
            </div>
        </button>
    );
}
