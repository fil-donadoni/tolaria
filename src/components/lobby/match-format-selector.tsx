// Bo1/Bo3 match format selector (PRD #387). A small segmented control shown
// near deck selection in the lobby; the chosen value flows into Match creation
// as `bestOf` for every start action (Solo, vs-AI, 2-player). Mirrors the
// DifficultySelector pattern — same engine, one knob. Persisted by the lobby.

import { cn } from "~/lib/utils";
import type { MatchFormat } from "~/lib/session";

const OPTIONS: { value: MatchFormat; label: string }[] = [
    { value: 1, label: "Bo1" },
    { value: 3, label: "Bo3" },
];

export default function MatchFormatSelector({
    value,
    onChange,
    disabled = false,
}: {
    value: MatchFormat;
    onChange: (format: MatchFormat) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Match Format
            </span>
            <div
                role="radiogroup"
                aria-label="Match Format"
                className="inline-flex overflow-hidden rounded-sm border border-border-subtle/40"
            >
                {OPTIONS.map((opt) => {
                    const selected = opt.value === value;
                    return (
                        <button
                            key={opt.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            onClick={() => onChange(opt.value)}
                            className={cn(
                                "px-3 py-1 text-xs font-medium transition",
                                "disabled:cursor-not-allowed disabled:opacity-40",
                                selected
                                    ? "bg-accent text-surface-base"
                                    : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50"
                            )}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
