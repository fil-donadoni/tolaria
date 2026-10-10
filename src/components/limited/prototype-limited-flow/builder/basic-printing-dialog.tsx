// PROTOTYPE — throwaway. The printing picker a basic's art opens: the
// #4122 PrintingTile language (card image, picker ring, set code under it)
// over six real printings. One tap picks and closes.
import GameDialog from "~/components/ui/game-dialog";
import { getPrintedCardImageUrl } from "~/lib/images";
import { pickerRingClass } from "~/lib/picker-ring";
import { cn } from "~/lib/utils";
import type { BasicDef } from "./builder-data";

export default function BasicPrintingDialog({
    basic,
    current,
    count,
    onPick,
    onClose,
}: {
    basic: BasicDef | null;
    current: string | null;
    count: number;
    onPick: (id: string) => void;
    onClose: () => void;
}) {
    return (
        <GameDialog
            open={basic !== null}
            onOpenChange={(o) => !o && onClose()}
            title={basic ? `${basic.name} art` : ""}
            subtitle={
                basic
                    ? count > 0
                        ? `Applies to all ${count} ${basic.name}s in your deck.`
                        : `Used for every ${basic.name} you add.`
                    : undefined
            }
            size="wide"
            showCloseButton
            className="sm:max-w-3xl"
        >
            {basic && (
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
                    {basic.printings.map((p) => {
                        const selected = p.id === current;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => {
                                    onPick(p.id);
                                    onClose();
                                }}
                                aria-pressed={selected}
                                aria-label={`${p.setName} (${p.set})`}
                                title={p.setName}
                                className="flex min-w-0 flex-col items-center gap-1"
                            >
                                <div
                                    className={cn(
                                        "relative aspect-5/7 w-full overflow-hidden transition hover:-translate-y-0.5",
                                        pickerRingClass(selected)
                                    )}
                                >
                                    <img
                                        src={getPrintedCardImageUrl(p.id)}
                                        alt=""
                                        loading="lazy"
                                        className="size-full rounded-[var(--card-radius)] object-cover"
                                    />
                                </div>
                                <span
                                    className={cn(
                                        "max-w-full truncate text-[10px] uppercase tracking-wide",
                                        selected
                                            ? "text-parchment"
                                            : "text-text-muted"
                                    )}
                                >
                                    {p.set}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </GameDialog>
    );
}
