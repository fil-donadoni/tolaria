// `/admin/bug-reports` — the evidence a bug report carries (email, full game
// state, attachment), reachable from a page instead of only `bunx convex run
// bugReports:getReport … --prod` (issue #2250, following PR #2243's split).
import AdminPageFrame from "@/components/admin/admin-page-frame";
import BugReportsAdminPanel from "@/components/admin/bug-reports-admin-panel";

export default function AdminBugReportsRoute() {
    return (
        <AdminPageFrame
            title="Bug Reports"
            description="Every in-app bug report, newest first. The GitHub issue is the work item; this is the evidence the issue deliberately keeps off the public repo — reporter email, the full game state at the moment they filed, and the attachment. Read-only."
        >
            <BugReportsAdminPanel />
        </AdminPageFrame>
    );
}
