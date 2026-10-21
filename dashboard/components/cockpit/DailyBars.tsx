import type { DayPoint } from "../../../scripts/lib/workflow-trends";

/**
 * One figure of the window, day by day (UTC): a bar per day, its height
 * relative to the busiest day. The figures are in each bar's title and in
 * the chart's accessible name, so the chart is never the only carrier.
 */
export function DailyBars({
    days,
    value,
    format,
    label,
}: {
    days: readonly DayPoint[];
    value: (d: DayPoint) => number;
    format: (n: number) => string;
    /** What one bar counts, e.g. "PRs merged". */
    label: string;
}) {
    if (days.length === 0) return null;
    const values = days.map(value);
    const max = Math.max(...values);
    const summary = days
        .map((d, i) => `${d.day.slice(5)} ${format(values[i])}`)
        .join(", ");
    return (
        <figure className="mt-3">
            <div
                role="img"
                aria-label={`${label} by day: ${summary}`}
                className="flex h-16 items-end gap-0.5"
            >
                {days.map((d, i) => (
                    <div
                        key={d.day}
                        title={`${d.day}: ${format(values[i])}`}
                        className="bg-chart-1 min-h-px flex-1 rounded-t-sm"
                        style={{
                            height:
                                max > 0 ? `${(100 * values[i]) / max}%` : "1px",
                        }}
                    />
                ))}
            </div>
            <figcaption className="text-muted-foreground mt-1 flex justify-between text-[11px]">
                <span>{days[0].day.slice(5)}</span>
                <span>
                    {label} by day, max {format(max)}
                </span>
                <span>{days[days.length - 1].day.slice(5)}</span>
            </figcaption>
        </figure>
    );
}
