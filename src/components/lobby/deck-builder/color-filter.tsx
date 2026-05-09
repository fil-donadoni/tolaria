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
    exact: "Only one",
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
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
                {COLORS.map((c) => {
                    const active = selectedColors.includes(c);
                    return (
                        <button
                            key={c}
                            onClick={() => onToggleColor(c)}
                            className={cn(
                                "flex h-8 w-8 items-center justify-center rounded-full text-lg transition",
                                active
                                    ? "bg-white/20 ring-2 ring-white/60"
                                    : "bg-white/5 opacity-60 hover:opacity-100"
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
                            ? "bg-white/20 ring-2 ring-white/60"
                            : "bg-white/5 opacity-60 hover:opacity-100"
                    )}
                    aria-pressed={includeColorless}
                    aria-label="Colorless"
                    title="Colorless"
                >
                    <ManaSymbol symbol="C" />
                </button>
            </div>

            <div className="flex items-center gap-1 rounded border border-white/15 bg-white/5 p-0.5 text-[11px]">
                {(Object.keys(MODE_LABELS) as ColorMode[]).map((m) => (
                    <button
                        key={m}
                        onClick={() => onChangeMode(m)}
                        className={cn(
                            "rounded px-2 py-1 transition",
                            mode === m
                                ? "bg-white/20 text-white"
                                : "text-white/50 hover:text-white"
                        )}
                    >
                        {MODE_LABELS[m]}
                    </button>
                ))}
            </div>
        </div>
    );
}
