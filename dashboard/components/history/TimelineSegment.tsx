import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtMetric } from "../../lib/format";

/**
 * One segment of one stacked day column (PRD #3148 S3).
 *
 * The tooltip carries the segment's own value AND the day's total, because the
 * question a stacked bar raises is always "how much of that column is this?" —
 * and a stack is the one chart shape where a person cannot read the answer off
 * the axis.
 *
 * The numbers ride in `aria-label` too: a chart whose only reading is visual
 * is a chart a screen reader cannot use.
 */
export function TimelineSegment({
    d,
    fill,
    day,
    series,
    metric,
    value,
    dayTotal,
}: {
    /** The path — rounded on the topmost segment, square where it stacks. */
    d: string;
    fill: string;
    day: string;
    series: string;
    metric: string;
    value: number;
    dayTotal: number;
}) {
    const label = `${day}, ${series}: ${fmtMetric(metric, value)}; day total ${fmtMetric(metric, dayTotal)}`;
    return (
        <Tooltip>
            <TooltipTrigger
                render={<path d={d} fill={fill} tabIndex={0} role="img" />}
                aria-label={label}
            />
            <TooltipContent>
                <span className="flex flex-col">
                    <span className="font-semibold">{day}</span>
                    <span>
                        {series}: {fmtMetric(metric, value)}
                    </span>
                    <span className="text-muted-foreground">
                        day total {fmtMetric(metric, dayTotal)}
                    </span>
                </span>
            </TooltipContent>
        </Tooltip>
    );
}
