import type { Color } from "@convex/cards/types";
import { MANA_COLORS } from "@convex/gre/constants";
import BottomSheet from "~/components/ui/bottom-sheet";
import ManaSymbol from "~/components/cards/mana-symbol";
import { cn } from "~/lib/utils";

export interface ZoneColorFilterSheetProps {
    open: boolean;
    onClose: () => void;
    value: ReadonlySet<Color>;
    onToggle: (color: Color) => void;
    /** The zone's displayed name — names the sheet and its toggles. */
    zoneLabel: string;
}

/**
 * The Zone colour filter on coarse-pointer surfaces (issue #3678): the five
 * `ZoneColorFilterToggles` toggles at the 44px rung (ADR 0101 §2), held in a
 * sheet because five of them inline cost ~236px of header width. Toggling
 * applies live — the filter is momentary (ADR 0075), there is no confirm step.
 */
export default function ZoneColorFilterSheet({
    open,
    onClose,
    value,
    onToggle,
    zoneLabel,
}: ZoneColorFilterSheetProps) {
    return (
        <BottomSheet
            open={open}
            onClose={onClose}
            title={`${zoneLabel} colour filter`}
            marker="data-color-filter-sheet"
        >
            <div className="flex items-center justify-center gap-2 px-3 py-3">
                {MANA_COLORS.map((color) => {
                    const active = value.has(color);
                    return (
                        <button
                            key={color}
                            type="button"
                            onClick={() => onToggle(color)}
                            style={{
                                minHeight: "var(--control-h)",
                                minWidth: "var(--control-h)",
                            }}
                            className={cn(
                                "flex items-center justify-center rounded-full transition",
                                active
                                    ? "filter-chip-active"
                                    : "filter-chip-inactive"
                            )}
                            aria-pressed={active}
                            aria-label={`${zoneLabel} colour ${color}`}
                        >
                            <ManaSymbol symbol={color} className="size-6" />
                        </button>
                    );
                })}
            </div>
        </BottomSheet>
    );
}
