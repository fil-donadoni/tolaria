import type { MachineTrend } from "../../../scripts/lib/workflow-trends";
import { fmtNum, fmtSpread, fmtUsd } from "../../lib/format";
import { Section } from "../Section";
import { Term } from "../Term";
import { DataTable } from "./DataTable";

const sharePct = (n: number | null) => (n === null ? "–" : `${n.toFixed(2)} %`);

/** Each machine's own telemetry: what its `/next-ticket` issues cost and how
 *  long its sessions ran — this machine read now, the others at their last
 *  `weekly-report` run. */
export function MachinesPanel({
    machines,
    host,
}: {
    machines: readonly MachineTrend[];
    /** This machine, read fresh. */
    host: string;
}) {
    const errors = machines.flatMap((m) =>
        m.errors.map((e) => `${m.host}: ${e}`)
    );
    return (
        <Section
            id="machines"
            title="Machines"
            meta="telemetry:budget and telemetry:latency, the last seven days"
        >
            <DataTable
                label="Machines"
                columns={[
                    {
                        header: "machine",
                        cell: (m) =>
                            m.host === host ? `${m.host} (this one)` : m.host,
                    },
                    {
                        header: "/next-ticket issues",
                        numeric: true,
                        cell: (m) => fmtNum(m.issues),
                    },
                    {
                        header: <Term id="perIssue" />,
                        numeric: true,
                        cell: (m) => fmtSpread(m.issueUsd, fmtUsd),
                    },
                    {
                        header: <Term id="allowanceShare" />,
                        numeric: true,
                        cell: (m) => fmtSpread(m.issueSharePct, sharePct),
                    },
                    {
                        header: "sessions",
                        numeric: true,
                        cell: (m) => fmtNum(m.sessions),
                    },
                    {
                        header: <Term id="sessionMinutes" />,
                        numeric: true,
                        cell: (m) =>
                            fmtSpread(m.sessionWallMin, (n) => fmtNum(n)),
                    },
                ]}
                rows={machines}
                rowKey={(m) => m.host}
                empty="no machine reading"
            />
            {errors.length > 0 ? (
                <ul className="text-muted-foreground mt-2 list-disc pl-5 text-xs">
                    {errors.map((e) => (
                        <li key={e}>{e}</li>
                    ))}
                </ul>
            ) : null}
        </Section>
    );
}
