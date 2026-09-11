// `/admin/testers` — who may give a Verdict about a Bot decision (issue #3402,
// PRD #3397, ADR 0124 §1).
import AdminPageFrame from "@/components/admin/admin-page-frame";
import TestersAdminPanel from "@/components/admin/testers-admin-panel";

export default function AdminTestersRoute() {
    return (
        <AdminPageFrame
            title="Testers"
            description="A Verdict is a judgement about one Bot decision — “it should have played X here” — and the corpus of them is what the evaluation's weights are fitted to (ADR 0124). Grant the role to the accounts whose judgement should carry that weight. Every admin already has it."
        >
            <TestersAdminPanel />
        </AdminPageFrame>
    );
}
