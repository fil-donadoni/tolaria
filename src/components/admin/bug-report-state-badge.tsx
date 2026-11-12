// The GitHub state pill of one Bug Report (issue #9013).
import {
    githubStateLabel,
    type ReportGithubState,
} from "./bug-report-state-labels";

export default function BugReportStateBadge({
    state,
}: {
    state: ReportGithubState;
}) {
    return (
        <span
            data-testid="github-state"
            className="rounded-sm bg-accent-soft/30 px-1.5 py-0.5 text-[10px] tracking-wide text-accent-strong uppercase"
        >
            {githubStateLabel(state)}
        </span>
    );
}
