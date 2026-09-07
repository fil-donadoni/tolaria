import { Stats } from "../Stats";
import { fmtMetric, isAdditive } from "../../lib/format";
import type { HistoryChartData } from "../../lib/historyData";
import type { HistoryMeta } from "../../lib/historyPayload";
import { labelFor } from "../../glossary";
import { MetricTile } from "./MetricTile";

/**
 * The metric tiles above the History cards (PRD #3148 S3), ported from
 * `scripts/dashboard/history-tiles.js` (#2625/#2633).
 *
 * The first four metrics of the current dataset, totalled over the whole
 * slice, plus the leading value of the current split.
 *
 * A SHARE ONLY EXISTS WHEN THE PARTS SUM TO THE WHOLE. `avg_` / `max_` metrics
 * are statistics of the rows in their own group: dividing the top group's mean
 * by the overall mean is not a percentage of anything, and it can exceed 100.
 * So a non-additive metric reads "highest <metric>" instead — the honest
 * statement of what that row actually is.
 *
 * Every name is resolved against the dataset the ROWS were fetched for
 * (`charts.table`), never the one the picker currently shows: mid-flight the
 * two differ, and labelling `llm`'s totals with `agent_runs`' vocabulary is
 * how a tile comes to say something false rather than something stale.
 */
export function HistoryTiles({
    meta,
    charts,
}: {
    meta: HistoryMeta;
    charts: HistoryChartData;
}) {
    const { table, split, metric, total, bySplit } = charts;
    const names = Object.keys(meta.metrics[table] ?? {}).slice(0, 4);
    const top = bySplit[0];
    const topMetric = top?.[metric] as number | null | undefined;
    const totalMetric = total[metric] as number | null | undefined;

    return (
        <Stats>
            {names.map((m) => (
                <MetricTile
                    key={m}
                    term={`${table}.${m}`}
                    label={labelFor(m, table)}
                    value={fmtMetric(m, total[m] as number | null)}
                />
            ))}
            {top ? (
                <MetricTile
                    term={`${table}.${split}`}
                    label={`top ${labelFor(split, table)}`}
                    value={String(top[split] ?? "")}
                    note={
                        `${fmtMetric(metric, topMetric)}` +
                        (isAdditive(metric)
                            ? ` · ${(((topMetric ?? 0) / (totalMetric || 1)) * 100).toFixed(0)}% of total`
                            : ` · highest ${labelFor(metric, table)}`)
                    }
                />
            ) : null}
        </Stats>
    );
}
