import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtMetric } from "../../lib/format";

/**
 * One observed point on an unstacked series (PRD #3148 S3).
 *
 * The visible marker is 4px so overlapping series stay legible; the HIT TARGET
 * is a 12px transparent circle over it, because a 4px pointer target is one a
 * person misses. `tabIndex` makes it reachable from the keyboard like every
 * other control on this page.
 */
export function TimelinePoint({
    cx,
    cy,
    color,
    day,
    series,
    metric,
    value,
}: {
    cx: number;
    cy: number;
    color: string;
    day: string;
    series: string;
    metric: string;
    value: number;
}) {
    const label = `${day}, ${series}: ${fmtMetric(metric, value)}`;
    return (
        <>
            {/* A 2px ground-coloured ring keeps overlapping markers apart. */}
            <circle
                cx={cx.toFixed(1)}
                cy={cy.toFixed(1)}
                r="4"
                fill={color}
                stroke="var(--card)"
                strokeWidth="2"
            />
            <Tooltip>
                <TooltipTrigger
                    render={
                        <circle
                            cx={cx.toFixed(1)}
                            cy={cy.toFixed(1)}
                            r="12"
                            fill="transparent"
                            tabIndex={0}
                            role="img"
                        />
                    }
                    aria-label={label}
                />
                <TooltipContent>
                    <span className="flex flex-col">
                        <span className="font-semibold">{day}</span>
                        <span>
                            {series}: {fmtMetric(metric, value)}
                        </span>
                    </span>
                </TooltipContent>
            </Tooltip>
        </>
    );
}
