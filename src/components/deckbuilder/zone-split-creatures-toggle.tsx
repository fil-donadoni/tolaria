import { cn } from "~/lib/utils";

export interface ZoneSplitCreaturesToggleProps {
    on: boolean;
    onChange: (on: boolean) => void;
    /** The zone's displayed name, to keep the two toggles distinguishable. */
    zoneLabel: string;
}

/**
 * "Split creatures" layout switch (PRD #5384, issue #5399) — creatures above a
 * straight divider, non-creatures below, in the same columns. A layout option,
 * distinct from the All / Creatures / Non-creatures filter.
 */
export default function ZoneSplitCreaturesToggle({
    on,
    onChange,
    zoneLabel,
}: ZoneSplitCreaturesToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={`${zoneLabel} split creatures`}
            onClick={() => onChange(!on)}
            className={cn(
                "inline-flex items-center gap-2 rounded-sm border px-2 py-0.5 text-xs transition",
                on
                    ? "border-accent/60 text-parchment"
                    : "border-border-strong text-text-muted hover:text-parchment"
            )}
        >
            <span
                aria-hidden
                className={cn(
                    "relative h-4 w-7 shrink-0 rounded-full transition-colors",
                    on ? "bg-accent" : "bg-surface-elevated"
                )}
            >
                <span
                    className={cn(
                        "absolute top-0.5 size-3 rounded-full bg-parchment shadow transition-[left] motion-reduce:transition-none",
                        on ? "left-3.5" : "left-0.5"
                    )}
                />
            </span>
            Split creatures
        </button>
    );
}
