import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toneFillClass } from "../../lib/tones";
import { FOCUS_RING } from "../../lib/controls";
import { DynamicTerm } from "../DynamicTerm";
import { lookupTerm } from "../../glossary";
import type { ClaimItem } from "../../lib/nowTimeline";

/**
 * One claim on the timeline (#2631, ported in PRD #3148 S2): a pin at its
 * (proxy) take time with a tail running to "now".
 *
 * EVERY tail is open, and that is the signal rather than a simplification. A
 * released claim is by construction absent from `data.claims`, so there is
 * nothing here to draw with a closed tail — many long, unclosed tails is
 * exactly what "held and never released" looks like, which is the picture the
 * 2026-08-19 outage had no way to show.
 *
 * The tail is `ClaimTail`, drawn as a whole layer UNDER every pin — see that
 * file for why the two are separate, and why a 1px line was enough to make a
 * pin unclickable when they were interleaved.
 */
export function ClaimPin({ item }: { item: ClaimItem }) {
    const tip = lookupTerm(item.term)?.tip ?? "";
    const left = `${item.left.toFixed(2)}%`;
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <button
                        type="button"
                        data-issue={item.issue}
                        style={{ left }}
                        className={cn(
                            "absolute top-1/2 flex size-3.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[9px] text-white",
                            toneFillClass(item.tone),
                            FOCUS_RING
                        )}
                    />
                }
                aria-label={`issue #${item.issue} ${item.title}, ${item.state}, claimed and still held`}
            >
                <span aria-hidden="true">{item.mark}</span>
            </TooltipTrigger>
            <TooltipContent>
                <span>
                    #{item.issue} {item.title}
                    {tip ? " — " : ""}
                    {tip ? (
                        <DynamicTerm term={item.term} focusable={false}>
                            {item.state}
                        </DynamicTerm>
                    ) : null}
                    {item.reason ? ` (${item.reason})` : ""}
                </span>
            </TooltipContent>
        </Tooltip>
    );
}
