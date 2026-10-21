import type { Trends } from "../../../scripts/lib/workflow-trends";
import {
    commitUrl,
    fmtInstant,
    fmtNum,
    fmtPct,
    fmtSpread,
} from "../../lib/format";
import type { Tone } from "../../lib/tones";
import { Section } from "../Section";
import { Stat } from "../Stat";
import { Stats } from "../Stats";
import { DataTable } from "./DataTable";

const targetTone = (met: boolean | null): Tone =>
    met === null ? "neutral" : met ? "good" : "bad";

/** RED episodes on the base and how long each took to go green. */
export function RedPanel({ trends }: { trends: Trends }) {
    const r = trends.red;
    return (
        <Section
            id="red"
            title="RED episodes"
            meta="the base's health verdicts, against the RED ladder's target"
            tone={r.standing > 0 ? "bad" : undefined}
        >
            <Stats>
                <Stat term="redEpisodes" value={fmtNum(r.episodes)} />
                <Stat
                    term="stillRed"
                    value={fmtNum(r.standing)}
                    tone={r.standing > 0 ? "bad" : "good"}
                />
                <Stat
                    term="ownerFree"
                    value={fmtPct(r.ownerFreePct)}
                    note="target ≥ 80 %"
                    tone={targetTone(r.meetsOwnerFree)}
                />
                <Stat
                    term="hoursToGreen"
                    value={fmtSpread(r.hours, (n) => fmtNum(n, 1))}
                    note="target p90 < 6 h"
                    tone={targetTone(r.meetsP90)}
                />
            </Stats>
            <div className="mt-3">
                <DataTable
                    label="RED episodes"
                    columns={[
                        { header: "RED at", cell: (e) => fmtInstant(e.redAt) },
                        {
                            header: "first RED",
                            cell: (e) => (
                                <a
                                    className="text-primary font-mono underline-offset-2 hover:underline"
                                    href={commitUrl(e.shas[0])}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    {e.shas[0].slice(0, 8)}
                                </a>
                            ),
                        },
                        {
                            header: "hours",
                            numeric: true,
                            cell: (e) =>
                                `${fmtNum(e.hours, 1)}${e.greenAt === null ? " (standing)" : ""}`,
                        },
                        {
                            header: "owner needed",
                            cell: (e) => (e.ownerFree ? "no" : "yes"),
                        },
                    ]}
                    rows={trends.redEpisodes}
                    rowKey={(e) => e.shas[0]}
                    empty="no RED in the window"
                />
            </div>
        </Section>
    );
}
