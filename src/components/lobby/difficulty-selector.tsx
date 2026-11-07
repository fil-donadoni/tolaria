// vs-AI difficulty selector (issue #114). A small segmented control over the
// difficulty presets, shown next to "Play vs Bot". The chosen value is persisted
// by the lobby and flows through to the bot's search budget — same engine, one
// knob (see `convex/gre/difficulty.ts`).

import { DIFFICULTIES, type Difficulty } from "@convex/gre/difficulty";
import { DIFFICULTY_LABEL } from "~/lib/difficultyLabels";
import { cn } from "~/lib/utils";

/** Shown whatever level is selected, so the player is never surprised by a Bot
 *  that appears to read their hand: every level knows the decklist
 *  (`DIFFICULTY_KNOWS_OPPONENT`, `convex/gre/difficulty.ts`). */
const OPPONENT_KNOWLEDGE_LINE = "Knows your decklist and plays around it.";

/** Each level's tooltip: what its search budget buys. */
const DESCRIPTIONS: Record<Difficulty, string> = {
    medium: "A solid, fast opponent that reads clean tactics.",
    hard: "A deep search that reads tactics perfectly.",
    expert: "The deepest search.",
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
                Bot difficulty
            </span>
            <div
                role="radiogroup"
                aria-label="Bot difficulty"
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
                            title={DESCRIPTIONS[d]}
                            className={cn(
                                "px-3 py-1 text-xs font-medium transition",
                                "disabled:cursor-not-allowed disabled:opacity-40",
                                selected
                                    ? "bg-accent text-surface-base"
                                    : "bg-surface-elevated/30 text-text hover:bg-surface-elevated/50"
                            )}
                        >
                            {DIFFICULTY_LABEL[d]}
                        </button>
                    );
                })}
            </div>
            <span className="text-[11px] text-text-muted">
                {OPPONENT_KNOWLEDGE_LINE}
            </span>
        </div>
    );
}
