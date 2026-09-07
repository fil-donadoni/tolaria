import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toneFillClass } from "../../lib/tones";
import { FOCUS_RING } from "../../lib/controls";
import { GLOSSARY } from "../../glossary";
import type { PassItem } from "../../lib/nowTimeline";

/**
 * One pass on the timeline (#2631, ported in PRD #3148 S2).
 *
 * WIDTH is the pass's real duration (floored at a findable minimum); POSITION
 * is its start, only ever pushed rightward to clear the previous block. The
 * glyph is the third, shape-based channel beside hue and the accessible name —
 * `died`, `ran-nothing` and `landed` must be distinguishable WITHOUT colour.
 */
export function PassBlock({ item }: { item: PassItem }) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        data-pass={item.pass}
                        style={{
                            left: `${item.left.toFixed(2)}%`,
                            width: `${item.width.toFixed(2)}%`,
                        }}
                        className={cn(
                            "absolute inset-y-1 flex items-center justify-center rounded-sm text-[9px] text-white/90",
                            toneFillClass(item.tone),
                            FOCUS_RING
                        )}
                    />
                }
                aria-label={`pass ${item.pass}, ${item.outcome.replace("-", " ")} (exit ${item.claudeExit})`}
            >
                <span aria-hidden="true">{item.glyph}</span>
            </TooltipTrigger>
            <TooltipContent>
                {GLOSSARY[item.term].tip} — pass {item.pass}, exit{" "}
                {item.claudeExit}
            </TooltipContent>
        </Tooltip>
    );
}
