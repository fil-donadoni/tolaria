// Display strings for a Bug Report's GitHub issue state and its admin
// notification outcome (issue #9013). Pure — shared by the list row, the
// detail panel and the closed-history button.
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

export type ReportGithubState = FunctionReturnType<
    typeof api.bugReports.listBugReports
>[number]["githubState"];

export type ReportNotification = FunctionReturnType<
    typeof api.bugReports.listBugReports
>[number]["notification"];

const GITHUB_STATE_LABEL: Record<ReportGithubState, string> = {
    not_filed: "Not filed",
    open: "Open",
    closed_completed: "Closed · completed",
    closed_not_planned: "Closed · not planned",
};

export function githubStateLabel(state: ReportGithubState): string {
    return GITHUB_STATE_LABEL[state];
}

const NOTIFICATION_LABEL = {
    sent: "Admins emailed",
    skipped_cap: "Email skipped (daily cap)",
    failed: "Email failed",
} as const;

/** `null` for a row with no recorded outcome (filed before the email). */
export function notificationLabel(outcome: ReportNotification): string | null {
    return outcome === undefined ? null : NOTIFICATION_LABEL[outcome];
}
