import { useMemo } from "react";
import { Section } from "../Section";
import { Unavailable } from "../Unavailable";
import { fmtMetric } from "../../lib/format";
import type { MetricRow } from "../../lib/historyPayload";
import type { HistoryChartData } from "../../lib/historyData";
import {
    setSlice,
    syncUrlFromSlice,
    useHistorySlice,
} from "../../lib/historyState";
import { nextSort, type SortState } from "../../lib/dataSort";
import { GLOSSARY, labelFor } from "../../glossary";
import { DataTable } from "./DataTable";
import type { DataColumn } from "./DataColumn";

/**
 * The "Table" card (PRD #3148 S3) — every metric for the current slice, one
 * row per value of the split. Ported from
 * `scripts/dashboard/history-metrics-table.js` (#2625/#2633).
 *
 * ITS SORT IS THE SHARED ONE. Unlike Issues and Sessions, this table's column
 * sort lives in `historyState`'s slice, which means it round-trips through the
 * URL (#2635) — a link to "agent runs by role, sorted by output tokens" is a
 * link a person pastes. Sorting is client-side over rows already fetched, so
 * a header click writes the slice and syncs the address bar WITHOUT re-running
 * the three queries; the vanilla version called `refresh()` and paid for three
 * reads to reorder rows it already had.
 *
 * COLUMNS ARE RUNTIME. The split and the metric names come from `/api/meta`,
 * so the column set is rebuilt whenever the dataset changes and every header
 * resolves its label through the glossary QUALIFIED by the current dataset —
 * `messages` means `count(*)` in `llm` and `sum(msgs)` in `agent_runs`, and
 * they are different entries.
 */
export function MetricsCard({
    charts,
    error,
}: {
    charts: HistoryChartData | null;
    error: string | null;
}) {
    const slice = useHistorySlice();

    const columns = useMemo<readonly DataColumn<MetricRow>[]>(() => {
        if (!charts) return [];
        const { split, metrics } = charts;
        return [
            {
                key: split,
                term: `${slice.table}.${split}`,
                label: labelFor(split, slice.table),
                cell: (r) => String(r[split] ?? ""),
            },
            ...metrics.map(
                (m): DataColumn<MetricRow> => ({
                    key: m,
                    term: `${slice.table}.${m}`,
                    label: labelFor(m, slice.table),
                    num: true,
                    cell: (r) => fmtMetric(m, r[m] as number | null),
                })
            ),
        ];
    }, [charts, slice.table]);

    // `sort` is `null` until a header is clicked; the table is then ordered by
    // the CURRENT metric, which is the column a person came to the card for.
    const sort: SortState = {
        key: slice.sort ?? slice.metric,
        dir: slice.sortDir === 1 ? 1 : -1,
    };

    return (
        <Section
            title="Table"
            meta={`${GLOSSARY["card.table"].tip} Click a header to sort.`}
        >
            {error ? (
                <Unavailable
                    reason={`could not read the aggregate rows: ${error}`}
                    consequence="Every figure in this card, and in the two charts above it, is unavailable for this slice."
                />
            ) : (
                <DataTable
                    caption="Every metric for the current slice"
                    columns={columns}
                    rows={charts?.bySplit ?? []}
                    rowKey={(r) => String(r[charts?.split ?? ""] ?? "")}
                    sort={sort}
                    onSort={(key) => {
                        const next = nextSort(sort, key);
                        setSlice({ sort: next.key, sortDir: next.dir });
                        syncUrlFromSlice();
                    }}
                    emptyMessage="No rows for this dataset, metric and date range. Widen the range, or clear a filter chip."
                />
            )}
        </Section>
    );
}
