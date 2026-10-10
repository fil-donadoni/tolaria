// PROTOTYPE — throwaway. "Split creatures" switch: the MTGO creature /
// non-creature split as a layout option (distinct from the type filter).
import { cn } from "~/lib/utils";

export default function SplitToggle({
    on,
    onChange,
}: {
    on: boolean;
    onChange: (on: boolean) => void;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={on}
            onClick={() => onChange(!on)}
            className={cn(
                "inline-flex min-h-(--control-h-sm) items-center gap-2 rounded-sm border px-2 text-xs transition",
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
