// PROTOTYPE — throwaway. One big Add Basic tile: the chosen printing's art
// (tap → printing picker), its mana symbol, the deck count, − / + below.
import { ImagesIcon, MinusIcon, PlusIcon } from "lucide-react";
import ManaSymbol from "~/components/cards/mana-symbol";
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import type { BasicDef } from "./builder-data";

const TINT: Record<string, string> = {
    W: "from-amber-100/25",
    U: "from-sky-400/30",
    B: "from-violet-500/30",
    R: "from-red-500/30",
    G: "from-emerald-500/30",
};

export default function BasicTile({
    basic,
    printId,
    count,
    compact,
    onOpenArt,
    onBump,
}: {
    basic: BasicDef;
    printId: string;
    count: number;
    compact: boolean;
    onOpenArt: () => void;
    onBump: (d: number) => void;
}) {
    const set = basic.printings.find((p) => p.id === printId)?.set ?? "";
    return (
        <div
            className={cn(
                "flex min-w-0 flex-col overflow-hidden rounded-[var(--panel-radius)] border bg-gradient-to-b to-transparent transition",
                TINT[basic.key],
                count > 0
                    ? "border-[var(--hairline-strong)]"
                    : "border-border-subtle/40 opacity-80"
            )}
        >
            <button
                type="button"
                onClick={onOpenArt}
                aria-label={`Choose ${basic.name} art (${set})`}
                className={cn(
                    "group relative w-full overflow-hidden",
                    compact
                        ? "h-11"
                        : "aspect-[4/3] sm:aspect-[16/10] lg:aspect-[2/1]"
                )}
            >
                <img
                    src={getArtCropImageUrl(printId)}
                    alt=""
                    className="size-full object-cover transition duration-300 group-hover:scale-105"
                />
                <span
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/30"
                />
                <ManaSymbol
                    symbol={basic.key}
                    className={cn(
                        "absolute left-1.5 top-1.5 drop-shadow",
                        compact ? "size-4" : "size-5 sm:size-6"
                    )}
                />
                <span className="absolute right-1 top-1 hidden items-center gap-0.5 rounded-sm bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-parchment/90 sm:inline-flex">
                    <ImagesIcon className="size-2.5" />
                    {set}
                </span>
                <span
                    className={cn(
                        "absolute bottom-0.5 right-1.5 font-display leading-none tabular-nums drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]",
                        count > 0 ? "text-parchment" : "text-parchment/50",
                        compact ? "text-xl" : "text-3xl sm:text-4xl"
                    )}
                >
                    {count}
                </span>
                {!compact && (
                    <span className="absolute bottom-1 left-1.5 hidden truncate text-[11px] font-semibold text-parchment/90 sm:block">
                        {basic.name}
                    </span>
                )}
            </button>
            <div className="flex divide-x divide-border-subtle/40 border-t border-border-subtle/40">
                <button
                    type="button"
                    onClick={() => onBump(-1)}
                    disabled={count === 0}
                    aria-label={`Remove a ${basic.name}`}
                    className={cn(
                        "flex flex-1 items-center justify-center text-text-muted transition hover:bg-surface-elevated/60 hover:text-parchment disabled:opacity-30",
                        compact ? "h-7" : "h-9"
                    )}
                >
                    <MinusIcon className="size-4" />
                </button>
                <button
                    type="button"
                    onClick={() => onBump(1)}
                    aria-label={`Add a ${basic.name}`}
                    className={cn(
                        "flex flex-1 items-center justify-center text-text-muted transition hover:bg-surface-elevated/60 hover:text-parchment",
                        compact ? "h-7" : "h-9"
                    )}
                >
                    <PlusIcon className="size-4" />
                </button>
            </div>
        </div>
    );
}
