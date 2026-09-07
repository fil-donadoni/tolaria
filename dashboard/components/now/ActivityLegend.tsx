import { Term } from "../Term";

/**
 * The activity chart's key (issue #3135, ported in PRD #3148 S2).
 *
 * The chart plots two series against two different axes — output tokens as
 * bars on the left, PRs merged as a line on the right — so nothing on it says
 * which colour is which. The swatch is the only place that does, and each
 * label is a glossary term, so "output tokens" can also say what it counts.
 *
 * The swatches read their colour from the SAME `--chart-*` slots the SVG
 * draws with, as Tailwind utilities rather than inline `var()`, so a legend
 * cannot drift from the marks it explains.
 */
export function ActivityLegend() {
    return (
        <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
                <span
                    aria-hidden="true"
                    className="bg-chart-1 inline-block size-2.5 rounded-[2px]"
                />
                <Term id="activity.outTok">output tokens</Term>
            </span>
            <span className="flex items-center gap-1.5">
                <span
                    aria-hidden="true"
                    className="bg-chart-2 inline-block h-0.5 w-4 rounded-full"
                />
                <Term id="activity.merged">PRs merged</Term>
            </span>
        </div>
    );
}
