import type { Trends } from "../../../scripts/lib/workflow-trends";
import { Section } from "../Section";
import { Term } from "../Term";
import { DataTable } from "./DataTable";

/** The flakes the queue's re-run and health's fresh run caught, most
 *  frequent first. */
export function FlakyPanel({ trends }: { trends: Trends }) {
    return (
        <Section
            id="flaky"
            title="Flaky tests"
            meta={<Term id="flaky">what counts as flaky</Term>}
        >
            <DataTable
                label="Flaky tests"
                columns={[
                    {
                        header: "subject",
                        cell: (r) => (
                            <span className="font-mono break-all">
                                {r.subject}
                            </span>
                        ),
                    },
                    { header: "caught by", cell: (r) => r.source },
                    { header: "times", numeric: true, cell: (r) => r.count },
                    {
                        header: "cause",
                        cell: (r) => r.causes.join(", ") || "–",
                    },
                ]}
                rows={trends.flaky}
                rowKey={(r) => `${r.source}:${r.subject}`}
                empty="no flake recorded in the window"
            />
            {trends.flakyIssues.length > 0 ? (
                <div className="mt-3 text-xs">
                    <Term id="flakyIssues" />
                    <ul className="mt-1 list-disc pl-5">
                        {trends.flakyIssues.map((t) => (
                            <li key={t}>{t}</li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </Section>
    );
}
