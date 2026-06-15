// vs-AI difficulty selector (issue #114). A small segmented control over the
// difficulty presets, shown next to "Play vs AI". The chosen value is persisted
// by the lobby and flows through to the bot's search budget — same engine, one
// knob (see `convex/gre/difficulty.ts`).

import { DIFFICULTIES, type Difficulty } from "@convex/gre";
import { cn } from "~/lib/utils";

const LABELS: Record<Difficulty, string> = {
    easy: "Easy",
    medium: "Medium",
    hard: "Hard",
};

export default function DifficultySelector({
    value,
    onChange,
    disabled = false,
}: {
    value: Difficulty;
    onChange: (difficulty: Difficulty) => void;
    disabled?: boolean;
}) {
    return (
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                AI Difficulty
            </span>
            <div
                role="radiogroup"
                aria-label="AI Difficulty"
                className="inline-flex overflow-hidden rounded-sm border border-border-subtle/40"
            >
                {DIFFICULTIES.map((d) => {
                    const selected = d === value;
                    return (
                        <button
                            key={d}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={disabled}
                            onClick={() => onChange(d)}
                            className={cn(
                                "px-3 py-1 text-xs font-medium transition",
                                "disabled:cursor-not-allowed disabled:opacity-40",
                                selected
                                    ? "bg-accent text-surface-base"
                                    : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50"
                            )}
                        >
                            {LABELS[d]}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
