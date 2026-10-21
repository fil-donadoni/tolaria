import type { Trends } from "../../../scripts/lib/workflow-trends";
import {
    LANDING_CAUSES,
    LANDING_CAUSE_LABEL,
    type LandingCause,
} from "../../../scripts/lib/landing-causes";
import { fmtInstant, fmtNum, fmtRatio, pullUrl } from "../../lib/format";
import type { Tone } from "../../lib/tones";
import { Section } from "../Section";
import { Stat } from "../Stat";
import { Stats } from "../Stats";
import { DailyBars } from "./DailyBars";
import { DataTable } from "./DataTable";

/** Amendment I's band: 5–10 % failed is the expected, above it the flow
 *  pays for it. */
function rateTone(rate: number | null): Tone {
    if (rate === null) return "unknown";
    return rate > 0.1 ? "bad" : rate > 0.05 ? "warn" : "good";
}

/** How many of the latest episodes the table lists. */
const RECENT = 15;

/** Failed landings by cause — what moves the number. */
export function LandingsPanel({ trends }: { trends: Trends }) {
    const l = trends.landings;
    const recent = [...trends.landingEpisodes].reverse().slice(0, RECENT);
    return (
        <Section
            id="landings"
            title="Failed landings"
            meta="land-failed episodes, by Amendment I's causes"
        >
            <Stats>
                <Stat
                    term="failedRate"
                    value={fmtRatio(l.rate)}
                    tone={rateTone(l.rate)}
                    note="expected 5–10 %"
                />
                <Stat term="episodes" value={fmtNum(l.episodes)} />
                <Stat term="attempts" value={fmtNum(l.attempts)} />
            </Stats>
            <div className="mt-3 flex flex-col gap-4">
                <DataTable<LandingCause>
                    label="Failed landings by cause"
                    columns={[
                        {
                            header: "cause",
                            cell: (c) => LANDING_CAUSE_LABEL[c],
                        },
                        {
                            header: "episodes",
                            numeric: true,
                            cell: (c) => l.byCause[c],
                        },
                    ]}
                    rows={LANDING_CAUSES}
                    rowKey={(c) => c}
                    empty="no cause"
                />
                <DataTable
                    label="The latest failed-landing episodes"
                    columns={[
                        {
                            header: "PR",
                            cell: (e) => (
                                <a
                                    className="text-primary underline-offset-2 hover:underline"
                                    href={pullUrl(e.pr)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    #{e.pr}
                                </a>
                            ),
                        },
                        { header: "at", cell: (e) => fmtInstant(e.at) },
                        {
                            header: "cause",
                            cell: (e) => LANDING_CAUSE_LABEL[e.cause],
                        },
                    ]}
                    rows={recent}
                    rowKey={(e) => `${e.pr}-${e.at}`}
                    empty="no failed landing in the window"
                />
            </div>
            <DailyBars
                days={trends.daily}
                value={(d) => d.failedLandings}
                format={(n) => fmtNum(n)}
                label="Failed landings"
            />
        </Section>
    );
}
