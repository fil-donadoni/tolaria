import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { fmtClockMs, fmtTokens, fmtUsd } from "../../lib/format";
import { HOUR_MS, type ActivityRow } from "../../lib/nowActivity";

/**
 * One hour's hit target on the activity chart (issue #3135, ported in S2).
 *
 * A transparent rect covering the WHOLE column, drawn last so it sits above
 * the bar and the merge line: an hour with two output tokens still has a
 * target a pointer can find, and `tabindex` makes it reachable from the
 * keyboard like every other control on this page.
 *
 * The numbers ride in the tooltip AND in the accessible name — a chart whose
 * only reading is visual is a chart a screen reader cannot use.
 */
export function ActivityHour({
    row,
    x,
    y,
    width,
    height,
}: {
    row: ActivityRow;
    x: number;
    y: number;
    width: number;
    height: number;
}) {
    const start = fmtClockMs(row.hourStart) ?? "";
    const end = fmtClockMs(row.hourStart + HOUR_MS) ?? "";
    const lines = [
        `${start}–${end}`,
        `output tokens: ${fmtTokens(row.outTok)}`,
        `input tokens: ${fmtTokens(row.inTok)} · cache reads: ${fmtTokens(row.cacheRead)}`,
        `messages: ${fmtTokens(row.messages)} · cost: ${fmtUsd(row.cost)}`,
        `PRs merged: ${row.merged}`,
    ];
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <rect
                        x={x.toFixed(1)}
                        y={y}
                        width={width.toFixed(1)}
                        height={height}
                        fill="transparent"
                        tabIndex={0}
                        role="img"
                    />
                }
                aria-label={lines.join("; ")}
            />
            <TooltipContent>
                <span className="flex flex-col">
                    {lines.map((line) => (
                        <span key={line}>{line}</span>
                    ))}
                </span>
            </TooltipContent>
        </Tooltip>
    );
}
