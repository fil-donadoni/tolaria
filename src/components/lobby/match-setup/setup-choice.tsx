// One answer a setup step offers (PRD #5334, issue #5340): a pressable card
// with a title and one supporting line. `aria-pressed` carries the selection,
// so the step's current answer is legible to a screen reader as well as by
// its accent edge.
import { cn } from "~/lib/utils";

export default function SetupChoice({
    title,
    hint,
    selected,
    disabled = false,
    onSelect,
}: {
    title: string;
    hint?: string;
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={onSelect}
            className={cn(
                "flex min-h-[var(--control-h)] min-w-[9rem] flex-1 flex-col rounded-[var(--panel-radius)] border px-3 py-2 text-left transition",
                "disabled:cursor-not-allowed disabled:opacity-50",
                selected
                    ? "border-accent bg-accent/10"
                    : "border-border-strong hover:border-accent/60"
            )}
        >
            <span className="text-sm font-medium text-parchment">{title}</span>
            {hint && <span className="text-xs text-text-muted">{hint}</span>}
        </button>
    );
}
