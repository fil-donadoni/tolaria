import { NowSection } from "./NowSection";
import { ActivityChart } from "./ActivityChart";
import { Stats } from "../Stats";
import { Stat } from "../Stat";
import { Unavailable } from "../Unavailable";
import { EmptyNote } from "../EmptyNote";
import { fmtClockMs, fmtTokens, fmtUsd } from "../../lib/format";
import { ACTIVITY_WINDOW_HOURS, activityRows } from "../../lib/nowActivity";
import type { NowPayload } from "../../lib/nowPayload";

export const ACTIVITY_SECTION_ID = "ls-section-activity";

/**
 * Activity by hour (issue #3135, ported in PRD #3148 S2).
 *
 * `activityError` renders the UNAVAILABLE note and NO chart. A flat line of
 * zeros would read as "a quiet day", which is the exact lie every other
 * section on this page refuses to tell — and the one that matters most here,
 * because a quiet day and a broken transcript read look identical on a bar
 * chart.
 */
export function ActivitySection({
    data,
    nowMs,
}: {
    data: NowPayload;
    nowMs: number;
}) {
    if (data.activityError != null) {
        return (
            <NowSection
                id={ACTIVITY_SECTION_ID}
                term="section.activity"
                title="Activity by hour"
            >
                <Unavailable
                    reason={data.activityError}
                    consequence="cannot tell what ran in the last 24 hours — not the same as a quiet day"
                />
            </NowSection>
        );
    }

    const rows = activityRows(data, nowMs);
    const outTok = rows.reduce((s, r) => s + r.outTok, 0);
    const cost = rows.reduce((s, r) => s + r.cost, 0);
    const merged = rows.reduce((s, r) => s + r.merged, 0);
    const busiest = rows.reduce(
        (best, r) => (r.outTok > best.outTok ? r : best),
        rows[0]
    );
    const anything = rows.some((r) => r.outTok > 0 || r.merged > 0);
    const asOf = data.activity?.asOf ? fmtClockMs(data.activity.asOf) : null;

    return (
        <NowSection
            id={ACTIVITY_SECTION_ID}
            term="section.activity"
            title="Activity by hour"
            meta={`local time${asOf ? ` · as of ${asOf}` : ""}`}
        >
            <div className="flex flex-col gap-3">
                <Stats>
                    <Stat
                        term="activity.outTok"
                        label="output tokens, 24h"
                        value={fmtTokens(outTok)}
                    />
                    <Stat
                        term="activity.cost"
                        label="list-price cost, 24h"
                        value={fmtUsd(cost)}
                    />
                    <Stat
                        term="activity.merged"
                        label="PRs merged, 24h"
                        value={String(merged)}
                    />
                    <Stat
                        term="activity.outTok"
                        label="busiest hour"
                        value={
                            busiest && busiest.outTok > 0
                                ? (fmtClockMs(busiest.hourStart) ?? "—")
                                : "—"
                        }
                        note={
                            busiest && busiest.outTok > 0
                                ? `${fmtTokens(busiest.outTok)} output tokens`
                                : undefined
                        }
                    />
                </Stats>

                {data.recentMergesError != null ? (
                    <Unavailable
                        reason={data.recentMergesError}
                        consequence="the merged-PR line may be incomplete"
                    />
                ) : null}

                {anything ? (
                    <div className="overflow-x-auto">
                        <ActivityChart rows={rows} />
                    </div>
                ) : (
                    <EmptyNote>
                        {`No tokens generated and nothing merged in the last ${ACTIVITY_WINDOW_HOURS} hours.`}
                    </EmptyNote>
                )}
            </div>
        </NowSection>
    );
}
