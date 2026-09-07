import { cn } from "@/lib/utils";
import { toneRuleClass } from "../../lib/tones";
import { DynamicTerm } from "../DynamicTerm";
import type { ReceiptStat } from "../../lib/nowReceipts";

/**
 * A stat box whose glossary key is composed at runtime (PRD #3148 S2).
 *
 * The batch's per-ROLE figures are the one place on this page where the set of
 * boxes is decided by the data: a receipt's `role` is an open string the
 * server supplies, so `role.<name>` cannot be a `TermId`. Everything else uses
 * `<Stat>` and its typed key — this is the narrow exception, not a second way
 * to render a figure.
 */
export function DynamicStat({ stat }: { stat: ReceiptStat }) {
    return (
        <div
            className={cn(
                "bg-card rounded-md border p-2.5",
                stat.tone && `border-l-2 ${toneRuleClass(stat.tone)}`
            )}
        >
            <div className="text-lg leading-tight font-semibold tabular-nums">
                {stat.value}
            </div>
            <div className="text-muted-foreground mt-0.5 text-xs">
                <DynamicTerm term={stat.term}>{stat.label}</DynamicTerm>
            </div>
        </div>
    );
}
