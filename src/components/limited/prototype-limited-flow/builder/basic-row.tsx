// PROTOTYPE — throwaway. Add Basic for a narrow side rail: one wide row per
// basic — art strip (tap → printing picker) with its mana symbol and set,
// the name and count, then − / +.
import { ImagesIcon, MinusIcon, PlusIcon } from "lucide-react";
import ManaSymbol from "~/components/cards/mana-symbol";
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import type { BasicDef } from "./builder-data";

export default function BasicRow({
    basic,
    printId,
    count,
    onOpenArt,
    onBump,
}: {
    basic: BasicDef;
    printId: string;
    count: number;
    compact?: boolean;
    onOpenArt: () => void;
    onBump: (d: number) => void;
}) {
    const set = basic.printings.find((p) => p.id === printId)?.set ?? "";
    return (
        <div
            className={cn(
                "flex items-center gap-3 overflow-hidden rounded-[var(--panel-radius)] border pr-2 transition",
                count > 0
                    ? "border-[var(--hairline-strong)] bg-surface-elevated/30"
                    : "border-border-subtle/40 opacity-80"
            )}
        >
            <button
                type="button"
                onClick={onOpenArt}
                aria-label={`Choose ${basic.name} art (${set})`}
                className="group relative h-16 w-20 shrink-0 overflow-hidden"
            >
                <img
                    src={getArtCropImageUrl(printId)}
                    alt=""
                    className="size-full object-cover transition duration-300 group-hover:scale-105"
                />
                <span
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-r from-black/50 to-transparent"
                />
                <ManaSymbol
                    symbol={basic.key}
                    className="absolute left-1.5 top-1.5 size-5 drop-shadow"
                />
                <span className="absolute bottom-1 left-1.5 inline-flex items-center gap-0.5 rounded-sm bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-parchment/90">
                    <ImagesIcon className="size-2.5" />
                    {set}
                </span>
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-parchment">
                    {basic.name}
                </span>
            </div>
            <button
                type="button"
                onClick={() => onBump(-1)}
                disabled={count === 0}
                aria-label={`Remove a ${basic.name}`}
                className="flex size-8 items-center justify-center rounded-sm border border-border-subtle/50 text-text-muted transition hover:text-parchment disabled:opacity-30"
            >
                <MinusIcon className="size-4" />
            </button>
            <span
                className={cn(
                    "w-7 text-center font-display text-2xl tabular-nums",
                    count > 0 ? "text-parchment" : "text-text-disabled"
                )}
            >
                {count}
            </span>
            <button
                type="button"
                onClick={() => onBump(1)}
                aria-label={`Add a ${basic.name}`}
                className="flex size-8 items-center justify-center rounded-sm border border-border-subtle/50 text-text-muted transition hover:text-parchment"
            >
                <PlusIcon className="size-4" />
            </button>
        </div>
    );
}
