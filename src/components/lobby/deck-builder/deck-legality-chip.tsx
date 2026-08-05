import { useState } from "react";
import type { Reason } from "@convex/formats";
import {
    Popover,
    PopoverTrigger,
    PopoverContent,
} from "@/components/ui/popover";

export interface DeckLegalityChipProps {
    /** The Format's human-readable label, shown in the disclosure heading. */
    formatLabel: string;
    isLegal: boolean;
    reasons: Reason[];
}

/**
 * Compact legality readout (issue #2056 defect 3 amplification): the same
 * `validateDeck` result `DeckLegalityPanel` shows as its own dedicated ~48px
 * band, collapsed to a single inline badge for `SaveDeckBar`'s
 * `short-viewport:` row. A legal deck costs one static badge. An illegal
 * deck's reasons list only costs height while the disclosure is OPEN (a
 * `Popover`, positioned as a floating layer) — never while closed, which is
 * what makes "legality 0" achievable inside the short-viewport chrome
 * budget instead of `DeckLegalityPanel`'s always-reserved band.
 */
export default function DeckLegalityChip({
    formatLabel,
    isLegal,
    reasons,
}: DeckLegalityChipProps) {
    const [open, setOpen] = useState(false);

    if (isLegal) {
        return (
            <span
                title={`${formatLabel} legal`}
                className="rounded-sm bg-success/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-success-strong"
            >
                Legal
            </span>
        );
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                className="rounded-sm bg-danger/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-danger-strong"
                title={`${formatLabel} illegal — ${reasons.length} reason(s), tap for detail`}
            >
                Illegal ({reasons.length})
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="max-w-64">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {formatLabel} legality
                </p>
                <ul className="flex flex-col gap-0.5">
                    {reasons.map((r) => (
                        <li
                            key={`${r.code}:${r.message}`}
                            className="text-xs text-danger-strong/90"
                        >
                            {r.message}
                        </li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}
