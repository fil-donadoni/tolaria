import { cn } from "~/lib/utils";
import type { MatchMode } from "./useCardSearch";

interface MatchModePillsProps {
    mode: MatchMode;
    onChange: (mode: MatchMode) => void;
}

const MODE_LABELS: Record<MatchMode, string> = {
    all: "All of these",
    any: "At least one",
};

const ORDER: MatchMode[] = ["all", "any"];

/** Two-pill toggle controlling whether multiple selected values combine with
 *  AND (`all`) or OR (`any`). Rendered by the type/set filters only when 2+
 *  values are selected — a single value makes the choice meaningless. */
export default function MatchModePills({
    mode,
    onChange,
}: MatchModePillsProps) {
    return (
        <div className="flex items-center gap-1 rounded-sm border border-border-subtle/40 bg-surface-elevated/20 p-0.5 text-[11px]">
            {ORDER.map((m) => (
                <button
                    key={m}
                    onClick={() => onChange(m)}
                    className={cn(
                        "rounded-sm px-2 py-1 transition",
                        mode === m ? "segment-active" : "segment-inactive"
                    )}
                    aria-pressed={mode === m}
                >
                    {MODE_LABELS[m]}
                </button>
            ))}
        </div>
    );
}
