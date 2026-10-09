import CardImage from "~/components/cards/card-image";
import { cn } from "~/lib/utils";
import { pickerRingClass } from "~/lib/picker-ring";
import { printingKind, type PickerPrinting } from "~/lib/printingPicker";

interface PrintingTileProps {
    printing: PickerPrinting;
    /** Set code, `#n`-disambiguated among same-Set variants (`editionOptions`). */
    label: string;
    setName: string;
    selected: boolean;
    onSelect: (printing: PickerPrinting) => void;
}

/** One printing in the picker grid (issue #4122): its image (lazy — a basic
 *  land's grid runs to hundreds), its Set code under it, a Promo / Digital
 *  badge, the full Set name on hover. The chosen one carries the zone
 *  pickers' `selected` ring (`pickerRingClass`), every other one `candidate`. */
export default function PrintingTile({
    printing,
    label,
    setName,
    selected,
    onSelect,
}: PrintingTileProps) {
    const kind = printingKind(printing);
    return (
        <button
            type="button"
            onClick={() => onSelect(printing)}
            aria-pressed={selected}
            aria-label={
                kind === "paper"
                    ? `${setName} (${label})`
                    : `${setName} (${label}), ${kind}`
            }
            title={setName}
            data-print-id={printing.printId}
            className="flex min-w-0 flex-col items-center gap-1"
        >
            <div
                className={cn(
                    "relative aspect-5/7 w-full overflow-hidden transition",
                    pickerRingClass(selected)
                )}
            >
                <CardImage
                    card={{ id: printing.printId }}
                    lazy
                    promoteLayer={false}
                    holdPreview={false}
                />
                {kind !== "paper" && (
                    <span className="absolute right-1 bottom-1 rounded-sm bg-surface-base/85 px-1 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
                        {kind}
                    </span>
                )}
            </div>
            <span
                className={cn(
                    "max-w-full truncate text-[10px] uppercase tracking-wide",
                    selected ? "text-parchment" : "text-text-muted"
                )}
            >
                {label}
            </span>
        </button>
    );
}
