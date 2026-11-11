import { Bug } from "lucide-react";
import { requestBugReport } from "~/lib/bug-report-requests";

/**
 * "Report a problem" in the card preview (issue #9162): visible to EVERY
 * viewer, not the admin-only Engine view, and opening the in-app bug report
 * (never GitHub) with this card as its subject. Same bug icon as
 * `BugReportButton`, so the two read as one affordance.
 */
export default function CardPreviewReportButton({
    cardName,
    cardId,
}: {
    cardName: string;
    cardId?: string | null;
}) {
    return (
        <button
            type="button"
            data-preview-report
            aria-label={`Report a problem with ${cardName}`}
            title="Report a problem"
            onClick={() => requestBugReport({ cardName, cardId })}
            className="flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-text-muted hover:text-parchment"
        >
            <Bug className="h-3.5 w-3.5" aria-hidden />
            Report a problem
        </button>
    );
}
