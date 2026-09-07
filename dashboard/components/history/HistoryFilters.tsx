import { DynamicTerm } from "../DynamicTerm";
import type { HistoryMeta } from "../../lib/historyPayload";
import {
    coerceSlice,
    setSlice,
    useHistorySlice,
    type HistorySlice,
} from "../../lib/historyState";
import { refreshHistory } from "../../lib/historyData";
import { labelFor } from "../../glossary";
import { DateField } from "./DateField";
import { FilterChip } from "./FilterChip";
import { MetaSelect } from "./MetaSelect";

/**
 * The shared History filter bar (PRD #3148 S3) — dataset, metric, split, date
 * range, and the value chips for the current split. Ported from
 * `scripts/dashboard/history-filters.js` (#2625/#2633/#2635).
 *
 * IT IS THE MAIN WRITER OF THE SLICE, and every write goes through
 * `refreshHistory()`, which is the one place "the slice changed" becomes "the
 * URL says so" (#2635). Two of the writes carry a correction with them, and
 * both were in the vanilla bar for a reason a bookmark makes obvious:
 *
 * - changing the DATASET clears the chip filters and the table sort. Chips
 *   name values of a dimension the new dataset may not have, and a sort names
 *   one of its metrics; carrying either across is how a filter comes to hide
 *   every row for a reason nothing on screen explains.
 * - changing the SPLIT clears the sort for the same reason, one column over.
 *
 * `coerceSlice` then pins whatever is left to what META actually offers, so a
 * dataset whose metric list does not include the current metric lands on its
 * first rather than on nothing.
 */
export function HistoryFilters({ meta }: { meta: HistoryMeta }) {
    const slice = useHistorySlice();
    const dims = meta.dimensions[slice.table] ?? [];
    const metrics = Object.keys(meta.metrics[slice.table] ?? {});
    const chipValues = meta.values[slice.table]?.[slice.split] ?? [];
    const active = new Set(slice.filters[slice.split] ?? []);

    const apply = (patch: Partial<HistorySlice>): void => {
        setSlice(coerceSlice({ ...slice, ...patch }, meta));
        void refreshHistory();
    };

    const toggleChip = (value: string): void => {
        const next = new Set(active);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        const filters = { ...slice.filters };
        if (next.size) filters[slice.split] = [...next];
        else delete filters[slice.split];
        apply({ filters });
    };

    return (
        <div className="bg-card flex flex-wrap items-end gap-3 rounded-lg border p-3">
            <MetaSelect
                caption="Dataset"
                value={slice.table}
                options={Object.keys(meta.dimensions)}
                onChange={(table) =>
                    // A new dataset means new dimensions and new metrics: the
                    // chips and the sort belong to the old one.
                    apply({ table, filters: {}, sort: null })
                }
            />
            <MetaSelect
                caption="Metric"
                value={slice.metric}
                options={metrics}
                scope={slice.table}
                onChange={(metric) => apply({ metric })}
            />
            <MetaSelect
                caption="Split by"
                value={slice.split}
                // `day` is the x-axis of every chart on this page; offering it
                // as a series would draw one bar per day per day.
                options={dims.filter((d) => d !== "day")}
                scope={slice.table}
                onChange={(split) => apply({ split, sort: null })}
            />
            <DateField
                label="From"
                value={slice.from}
                onChange={(from) => apply({ from })}
            />
            <DateField
                label="To"
                value={slice.to}
                onChange={(to) => apply({ to })}
            />
            <div className="min-w-[240px] flex-1">
                <div className="text-muted-foreground mb-1 text-xs">
                    Filter ·{" "}
                    <DynamicTerm term={`${slice.table}.${slice.split}`}>
                        {labelFor(slice.split, slice.table)}
                    </DynamicTerm>
                </div>
                <div className="flex flex-wrap gap-1">
                    {chipValues.map((v) => (
                        <FilterChip
                            key={v}
                            value={v}
                            active={active.has(v)}
                            onToggle={() => toggleChip(v)}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
