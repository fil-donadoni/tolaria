import type { CostGroup } from "../../../scripts/lib/workflow-trends";
import type { TermId } from "../../glossary";
import { fmtNum, fmtSpread, fmtUsd } from "../../lib/format";
import { Term } from "../Term";
import { DataTable } from "./DataTable";

/** Cost per issue split one way — by model or by area. */
export function CostTable({
    by,
    groups,
}: {
    by: Extract<TermId, "model" | "area">;
    groups: readonly CostGroup[];
}) {
    return (
        <DataTable
            label={`Cost per issue by ${by}`}
            columns={[
                { header: <Term id={by} />, cell: (g) => g.key },
                {
                    header: "issues",
                    numeric: true,
                    cell: (g) => fmtNum(g.issues),
                },
                {
                    header: "passes",
                    numeric: true,
                    cell: (g) => fmtNum(g.passes),
                },
                {
                    header: "total",
                    numeric: true,
                    cell: (g) => fmtUsd(g.totalUsd),
                },
                {
                    header: <Term id="perIssue">per issue, median / p90</Term>,
                    numeric: true,
                    cell: (g) => fmtSpread(g.perIssueUsd, fmtUsd),
                },
            ]}
            rows={groups}
            rowKey={(g) => g.key}
            empty="no pass in the window"
        />
    );
}
