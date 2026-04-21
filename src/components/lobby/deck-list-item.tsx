import type { DeckPreset } from "@convex/deckPresets";
import { cn } from "~/lib/utils";

interface DeckListItemProps {
    deck: DeckPreset;
    isSelected: boolean;
    onFocus: (presetId: string) => void;
}

const COLOR_CLASSES: Record<string, string> = {
    W: "bg-yellow-100 text-yellow-900",
    U: "bg-blue-400 text-blue-950",
    B: "bg-neutral-800 text-white",
    R: "bg-red-500 text-red-950",
    G: "bg-green-500 text-green-950",
    C: "bg-gray-400 text-gray-900",
};

function ColorPip({ color }: { color: string }) {
    return (
        <span
            className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                COLOR_CLASSES[color] ?? "bg-white/20 text-white"
            )}
            aria-label={color}
        >
            {color}
        </span>
    );
}

export default function DeckListItem({
    deck,
    isSelected,
    onFocus,
}: DeckListItemProps) {
    return (
        <button
            onClick={() => onFocus(deck.presetId)}
            className={cn(
                "flex w-full items-center gap-4 rounded border px-4 py-3 text-left transition",
                isSelected
                    ? "border-white/60 bg-white/10"
                    : "border-white/20 bg-white/5 hover:bg-white/10"
            )}
        >
            <div className="flex flex-1 flex-col gap-1">
                <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-white">
                        {deck.name}
                    </span>
                    {isSelected && (
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
                            Selected
                        </span>
                    )}
                </div>
                {deck.description && (
                    <span className="text-xs text-white/60">
                        {deck.description}
                    </span>
                )}
                <span className="text-[10px] uppercase tracking-wide text-white/40">
                    {deck.cards.length} cards · {deck.format}
                </span>
            </div>
            <div className="flex items-center gap-1">
                {deck.colors.map((c) => (
                    <ColorPip key={c} color={c} />
                ))}
            </div>
            <span className="text-xs text-white/60">View →</span>
        </button>
    );
}
