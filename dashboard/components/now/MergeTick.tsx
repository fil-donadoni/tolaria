import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "../../lib/controls";
import { GLOSSARY } from "../../glossary";
import type { MergeItem } from "../../lib/nowTimeline";

/**
 * One merged PR on the timeline (#2631, ported in PRD #3148 S2).
 *
 * The tick has no visible child, which in the vanilla markup was a hazard: the
 * tooltip engine filled every empty `[data-term]` element with its glossary
 * LABEL, painting a 45px-wide "merged" text run over a 5px tick and stealing
 * `:hover` from neighbours up to 22px away (#2842). A React trigger has no
 * scanner to fill it, so the failure mode is gone by construction — the
 * accessible name comes from `aria-label`, as it always should have.
 */
export function MergeTick({ item }: { item: MergeItem }) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        data-pr={item.number}
                        style={{ left: `${item.left.toFixed(2)}%` }}
                        className={cn(
                            "bg-chart-2 absolute inset-y-1.5 w-[3px] -translate-x-1/2 rounded-full",
                            FOCUS_RING
                        )}
                    />
                }
                aria-label={`PR #${item.number} merged: ${item.title}`}
            />
            <TooltipContent>
                {GLOSSARY["pr.merged"].tip} — #{item.number} {item.title}
            </TooltipContent>
        </Tooltip>
    );
}
