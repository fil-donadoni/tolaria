import { cn } from "~/lib/utils";
import ManaSymbol from "../../cards/mana-symbol";
import type { ColorMode } from "./useCardSearch";

const COLORS = ["W", "U", "B", "R", "G"] as const;

interface ColorFilterProps {
    selectedColors: string[];
    includeColorless: boolean;
    mode: ColorMode;
    onToggleColor: (color: string) => void;
    onToggleColorless: () => void;
    onChangeMode: (mode: ColorMode) => void;
}

const MODE_LABELS: Record<ColorMode, string> = {
    "include-any": "At least one",
    "include-all": "All of these",
    "at-most": "At most these",
};

export default function ColorFilter({
    selectedColors,
    includeColorless,
    mode,
    onToggleColor,
    onToggleColorless,
    onChangeMode,
}: ColorFilterProps) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1">
                {COLORS.map((c) => {
                    const active = selectedColors.includes(c);
                    return (
                        <button
                            key={c}
                            onClick={() => onToggleColor(c)}
                            className={cn(
                                "flex size-8 items-center justify-center rounded-full text-lg transition",
                                active
                                    ? "filter-chip-active"
                                    : "filter-chip-inactive"
                            )}
                            aria-pressed={active}
                            aria-label={`Color ${c}`}
                        >
                            <ManaSymbol symbol={c} />
                        </button>
                    );
                })}
                <button
                    onClick={onToggleColorless}
                    className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-lg transition",
                        includeColorless
                            ? "filter-chip-active"
                            : "filter-chip-inactive"
                    )}
                    aria-pressed={includeColorless}
                    aria-label="Colorless"
                    title="Colorless"
                >
                    <ManaSymbol symbol="C" />
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-1 rounded-sm border border-border-subtle/40 bg-surface-elevated/20 p-0.5 text-[11px]">
                {(Object.keys(MODE_LABELS) as ColorMode[]).map((m) => (
                    <button
                        key={m}
                        onClick={() => onChangeMode(m)}
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
        </div>
    );
}
