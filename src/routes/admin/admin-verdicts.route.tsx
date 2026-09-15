// `/admin/verdicts` — where a contested position is rebuilt and the
// contradiction resolved, and where any verdict is judged cold (issue #3582,
// PRD #3574, ADR 0128 §6).
import AdminPageFrame from "@/components/admin/admin-page-frame";
import VerdictColdOpenPanel from "@/components/admin/verdict-cold-open-panel";
import VerdictReviewPanel from "@/components/admin/verdict-review-panel";

export default function AdminVerdictsRoute() {
    return (
        <AdminPageFrame
            title="Verdict Review"
            description="Two testers who judged one position differently keep both judgements out of the Verdict Lock until someone looks at the board and decides. Resolving records which answer is right and why each other one is not; nothing is deleted."
        >
            <VerdictReviewPanel />
            <VerdictColdOpenPanel />
        </AdminPageFrame>
    );
}
