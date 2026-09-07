import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtMetric } from "../../lib/format";

/**
 * One bar of the Ranking card (PRD #3148 S3).
 *
 * ONE COLOUR for every bar, deliberately. This chart shows one measure over
 * nominal categories with a direct label on each row: colour would double-
 * encode bar length, and any ninth-and-beyond category would land in an
 * indistinguishable grey. The series ramp is for the "Over time" card, where
 * a series has to be identified ACROSS days.
 *
 * The rounded end is on the DATA end only — the bar stays anchored square to
 * the axis, because a rounded foot reads as a bar that starts somewhere other
 * than zero.
 */
export function RankingBar({
    x,
    y,
    width,
    label,
    metric,
    value,
}: {
    x: number;
    y: number;
    width: number;
    label: string;
    metric: string;
    value: number;
}) {
    const w = Math.max(2, width);
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <path
                        d={`M${x},${y + 4}h${w - 4}a4,4 0 0 1 4,4v6a4,4 0 0 1 -4,4h${-(w - 4)}Z`}
                        fill="var(--series-1)"
                        tabIndex={0}
                        role="img"
                    />
                }
                aria-label={`${label}: ${fmtMetric(metric, value)}`}
            />
            <TooltipContent>
                <span className="flex flex-col">
                    <span className="font-semibold">{label}</span>
                    <span>{fmtMetric(metric, value)}</span>
                </span>
            </TooltipContent>
        </Tooltip>
    );
}
