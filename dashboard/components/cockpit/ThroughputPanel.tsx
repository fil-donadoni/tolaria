import type { Trends } from "../../../scripts/lib/workflow-trends";
import { fmtNum, fmtSigned } from "../../lib/format";
import { Section } from "../Section";
import { Stat } from "../Stat";
import { Stats } from "../Stats";
import { DailyBars } from "./DailyBars";

/** Throughput and the drain forecast — is the queue going down, and when
 *  will it be empty. */
export function ThroughputPanel({ trends }: { trends: Trends }) {
    const { throughput: tp, drain } = trends;
    const net = tp.issuesClosed - tp.issuesOpened;
    return (
        <Section
            id="throughput"
            title="Throughput"
            meta={`over ${fmtNum(tp.hours)} h`}
        >
            <Stats>
                <Stat term="merged" value={fmtNum(tp.merged)} />
                <Stat term="prsPerHour" value={fmtNum(tp.prsPerHour, 2)} />
                <Stat
                    term="issuesNet"
                    value={fmtSigned(net)}
                    note={`${tp.issuesClosed} closed, ${tp.issuesOpened} opened`}
                    tone={net >= 0 ? "good" : "warn"}
                />
                <Stat term="ready" value={fmtNum(drain.ready)} />
                <Stat
                    term="drainDays"
                    value={fmtNum(drain.days, 1)}
                    note={`at ${fmtNum(drain.closedPerDay, 1)} closed a day`}
                />
                <Stat
                    term="netDrainDays"
                    value={fmtNum(drain.netDays, 1)}
                    note={`net ${fmtNum(drain.netPerDay, 1)} a day`}
                />
            </Stats>
            <DailyBars
                days={trends.daily}
                value={(d) => d.merged}
                format={(n) => fmtNum(n)}
                label="PRs merged"
            />
        </Section>
    );
}
