import type { Trends } from "../../../scripts/lib/workflow-trends";
import { fmtNum, fmtSpread } from "../../lib/format";
import { Section } from "../Section";
import { Stat } from "../Stat";
import { Stats } from "../Stats";

/** How long a pass takes, and how long its PR waits in the queue. */
export function LatencyPanel({ trends }: { trends: Trends }) {
    const outcomes = Object.entries(trends.pass.byOutcome).sort(([a], [b]) =>
        a.localeCompare(b)
    );
    return (
        <Section
            id="latency"
            title="Latency"
            meta="the afk-pass records; ready-to-land → merged"
        >
            <Stats>
                <Stat
                    term="passMinutes"
                    value={fmtSpread(trends.pass.minutes, (n) => fmtNum(n))}
                    note={`median / p90 over ${trends.pass.minutes.n} passes`}
                />
                <Stat
                    term="queueHours"
                    value={fmtSpread(trends.queueHours, (n) => fmtNum(n, 1))}
                    note={`median / p90 over ${trends.queueHours.n} PRs`}
                />
            </Stats>
            <p className="text-muted-foreground mt-3 text-xs">
                pass outcomes:{" "}
                {outcomes.length
                    ? outcomes.map(([o, n]) => `${o} ${n}`).join(" · ")
                    : "none in the window"}
            </p>
        </Section>
    );
}
