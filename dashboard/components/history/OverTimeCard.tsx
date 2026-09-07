import { useMemo } from "react";
import { Section } from "../Section";
import { Unavailable } from "../Unavailable";
import { EmptyNote } from "../EmptyNote";
import { colorFor, OTHER } from "../../lib/historyColors";
import type { HistoryChartData } from "../../lib/historyData";
import {
    OTHER_KEY,
    timelineShape,
    timelineSubtitle,
} from "../../lib/historyTimeline";
import { GLOSSARY, labelFor } from "../../glossary";
import { SeriesSwatch } from "./SeriesSwatch";
import { TimelineChart } from "./TimelineChart";

/**
 * The "Over time" card (PRD #3148 S3) — the chart, its legend, and the one
 * sentence that says how to read it.
 *
 * The subtitle leads with the glossary's fixed "what question does this
 * answer" sentence (`card.over-time`, #2633) and then states the thing only
 * this card knows: whether the columns stack. That second half is not
 * decoration — a stacked chart and a line chart of the same rows answer
 * different questions, and the metric is what decides which one is honest.
 */
export function OverTimeCard({
    charts,
    error,
}: {
    charts: HistoryChartData | null;
    error: string | null;
}) {
    const shape = useMemo(
        () =>
            charts
                ? timelineShape(charts.perDay, charts.split, charts.metric)
                : null,
        [charts]
    );

    const metricLabel = charts
        ? labelFor(charts.metric, charts.table)
        : "this metric";
    const splitLabel = charts ? labelFor(charts.split, charts.table) : "";

    return (
        <Section
            title={
                charts
                    ? `${metricLabel} per day, by ${splitLabel}`
                    : "Over time"
            }
            meta={
                shape
                    ? `${GLOSSARY["card.over-time"].tip} ${timelineSubtitle(shape, metricLabel)}`
                    : GLOSSARY["card.over-time"].tip
            }
        >
            {error ? (
                <Unavailable
                    reason={`could not read the daily rows: ${error}`}
                    consequence="How this metric moved over the range is unknown."
                />
            ) : !shape || shape.days.length === 0 ? (
                <EmptyNote>
                    No rows in this date range for the current dataset and
                    filters.
                </EmptyNote>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <TimelineChart
                            shape={shape}
                            split={charts!.split}
                            metric={charts!.metric}
                        />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {shape.seriesKeys.map((k) => (
                            <SeriesSwatch
                                key={k}
                                color={
                                    k === OTHER_KEY
                                        ? OTHER
                                        : colorFor(charts!.split, k)
                                }
                                label={k}
                            />
                        ))}
                    </div>
                </>
            )}
        </Section>
    );
}
