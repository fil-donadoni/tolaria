import type { Trends } from "../../../scripts/lib/workflow-trends";
import { fmtNum, fmtSpread, fmtUsd } from "../../lib/format";
import { Section } from "../Section";
import { Stat } from "../Stat";
import { Stats } from "../Stats";
import { CostTable } from "./CostTable";
import { DailyBars } from "./DailyBars";

/** What an issue costs, from every machine's `afk-pass` records — by the
 *  model that ran it and by its area. */
export function CostPanel({ trends }: { trends: Trends }) {
    const c = trends.cost;
    const gaps = [
        c.unknownCost ? `${c.unknownCost} passes recorded no cost` : null,
        c.recordsMissing
            ? `${c.recordsMissing} finished passes left no record`
            : null,
    ].filter((g): g is string => g !== null);
    return (
        <Section
            id="cost"
            title="Cost per issue"
            meta={`the afk-pass records, every machine${gaps.length ? ` — ${gaps.join("; ")}` : ""}`}
        >
            <Stats>
                <Stat term="passes" value={fmtNum(c.passes)} />
                <Stat term="passIssues" value={fmtNum(c.issues)} />
                <Stat term="passTotal" value={fmtUsd(c.totalUsd)} />
                <Stat
                    term="perIssue"
                    value={fmtSpread(c.perIssueUsd, fmtUsd)}
                    note="median / p90"
                />
            </Stats>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <CostTable by="model" groups={trends.costByModel} />
                <CostTable by="area" groups={trends.costByArea} />
            </div>
            <DailyBars
                days={trends.daily}
                value={(d) => d.passUsd}
                format={fmtUsd}
                label="Pass cost"
            />
        </Section>
    );
}
