import { useState } from "react";
import CardImage from "~/components/cards/card-image";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "~/components/ui/popover";
import { cn } from "~/lib/utils";
import { legalBasicLandPrintings, type BasicLandSubtype } from "./basicLands";

interface BasicLandArtPickerProps {
    subtype: BasicLandSubtype;
    /** The printing currently in effect for this subtype — whatever
     *  `cardIdsBySubtype[subtype]` already resolved to (stored preference,
     *  else Pool printing, else catalogue default; issue #1629). `null` only
     *  in the pathological case where the catalogue has no definition for
     *  this subtype at all — the control renders disabled, like the rest of
     *  the bar's controls for that subtype. */
    currentPrintId: string | null;
    /** The deck Format's allowed sets (`FORMAT_RULES[format].allowedSets`) —
     *  `null` offers every printing (issue #1629 AC3). */
    allowedSets: string[] | null;
    onSelect: (printId: string) => void;
    disabled?: boolean;
}

/** The compact control under each basic-land button (issue #1629): shows the
 *  currently-chosen printing as a thumbnail and opens a popover grid of every
 *  Format-legal printing on click. One click on a grid tile picks it and
 *  closes the popover. Every basic's printings differ ONLY by art — feeding
 *  each `printId` straight to `CardImage` (rather than inventing an image
 *  URL) is the only way to show them, since `CardPrinting` carries no image
 *  field (`convex/cards/catalogue.ts`).
 *
 *  Keyboard-reachable and closes on Escape/outside-click by construction —
 *  both are `Popover`'s (`~/components/ui/popover`, base-ui) own behavior,
 *  already relied on unchanged by `HotkeysLegend` and `MultiCombobox`. */
export default function BasicLandArtPicker({
    subtype,
    currentPrintId,
    allowedSets,
    onSelect,
    disabled = false,
}: BasicLandArtPickerProps) {
    const [open, setOpen] = useState(false);
    const printings = legalBasicLandPrintings(subtype, allowedSets);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
                type="button"
                disabled={disabled || currentPrintId === null}
                aria-label={`Choose ${subtype} art`}
                title={`Choose ${subtype} art`}
                className="flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border-subtle/40 bg-surface-elevated/40 transition hover:border-accent/60 disabled:opacity-40"
            >
                {currentPrintId !== null && (
                    <div className="size-full">
                        <CardImage
                            card={{ id: currentPrintId }}
                            promoteLayer={false}
                        />
                    </div>
                )}
            </PopoverTrigger>
            <PopoverContent className="w-64" align="start" side="bottom">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    {subtype} art
                </div>
                {printings.length === 0 ? (
                    <div className="text-[11px] text-text-muted">
                        No printings available for this Format.
                    </div>
                ) : (
                    <div className="grid grid-cols-4 gap-1.5">
                        {printings.map((p) => (
                            <button
                                key={p.printId}
                                type="button"
                                onClick={() => {
                                    onSelect(p.printId);
                                    setOpen(false);
                                }}
                                aria-label={`${subtype} — ${p.setCode.toUpperCase()}`}
                                aria-pressed={p.printId === currentPrintId}
                                className={cn(
                                    "aspect-5/7 overflow-hidden rounded-sm ring-2 transition",
                                    p.printId === currentPrintId
                                        ? "ring-accent"
                                        : "ring-transparent hover:ring-accent/50"
                                )}
                            >
                                <CardImage
                                    card={{ id: p.printId }}
                                    lazy
                                    promoteLayer={false}
                                />
                            </button>
                        ))}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
