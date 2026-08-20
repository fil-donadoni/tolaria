// Explicit game-mode selector (ADR 0101 §10, issue #2591): Arena mode | Cockatrice
// mode. This is the one place the mode is CHOSEN — it then drives deck
// filtering and the Play box's action set, the inverse of the pre-#2591 flow
// (which derived "manual or not" from whichever deck happened to be
// selected). Mirrors MatchFormatSelector's segmented-control shape (same
// radiogroup pattern, same test seam via `getByRole("radio", ...)`), plus a
// three-line tooltip per option (ADR 0101 §10) — labels only, the domain
// terms stay Game / Manual Game (CONTEXT.md).

import { cn } from "~/lib/utils";
import type { PlayMode } from "~/lib/session";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";

const OPTIONS: {
    value: PlayMode;
    label: string;
    tooltip: string;
}[] = [
    {
        value: "arena",
        label: "Arena mode",
        tooltip:
            "The engine enforces every rule.\nPlay vs Bot, Solo game, or open a table.\nOnly real (non-Manual) decks are offered.",
    },
    {
        value: "cockatrice",
        label: "Cockatrice mode",
        tooltip:
            "A free table — the players call the rules.\nEvery printed card is available.\nOnly Manual Decks are offered.",
    },
];

export default function PlayModeSelector({
    value,
    onChange,
    disabled = false,
}: {
    value: PlayMode;
    onChange: (mode: PlayMode) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Game Mode
            </span>
            <div
                role="radiogroup"
                aria-label="Game Mode"
                className="inline-flex overflow-hidden rounded-sm border border-border-subtle/40"
            >
                {OPTIONS.map((opt) => {
                    const selected = opt.value === value;
                    return (
                        <Tooltip key={opt.value}>
                            <TooltipTrigger
                                render={<button type="button" />}
                                role="radio"
                                aria-checked={selected}
                                disabled={disabled}
                                onClick={() => onChange(opt.value)}
                                className={cn(
                                    "segment-pill text-xs font-medium",
                                    "disabled:cursor-not-allowed disabled:opacity-40",
                                    selected
                                        ? "bg-accent text-surface-base"
                                        : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50"
                                )}
                            >
                                {opt.label}
                            </TooltipTrigger>
                            <TooltipContent className="whitespace-pre-line">
                                {opt.tooltip}
                            </TooltipContent>
                        </Tooltip>
                    );
                })}
            </div>
        </div>
    );
}
